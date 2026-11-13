import type { NextRequest } from 'next/server'

/*
 * `/api/v1/*`-ийг API руу дамжуулна. next.config-ийн rewrites-ийг ашиглаагүй шалтгаан: Next-ийн
 * rewrite proxy нь X-Forwarded-For нэмдэггүй (бүх хэрэглэгч нэг IP болж хүсэлтийн хязгаар, аудит
 * ажиллахгүй) бөгөөд хөтчийн илгээсэн X-Forwarded-For-ийг шууд дамжуулдаг (хуурамчаар IP солих).
 * Энд Next нь route handler-т жинхэнэ socket хаягийг x-forwarded-for болгон өгдөг (proxy.ts
 * хөтчийн илгээснийг устгана), API нь яг нэг hop-д итгэнэ.
 */

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** API-ийн express.json (2MB) ба логоны (2MB) хязгаараас бага зэрэг их. */
const MAX_BODY_BYTES = 3 * 1024 * 1024
const TIMEOUT_MS = 120_000

const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'host',
  // curl зэрэг клиент том body-д "Expect: 100-continue" илгээдэг — undici үүнийг дамжуулдаггүй.
  'expect',
])

const json = (status: number, code: string, message: string) =>
  Response.json({ success: false, error: { code, message } }, { status, headers: { 'Cache-Control': 'no-store' } })

/** Ажиллах үед уншина — Docker image-ийг өөр хаягтай орчинд дахин build хийлгүй ашиглана. */
const apiBase = () => (process.env.API_INTERNAL_URL ?? 'http://localhost:4301').replace(/\/+$/, '')

async function forward(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const declared = Number(request.headers.get('content-length') ?? 0)
  if (declared > MAX_BODY_BYTES) return json(413, 'PAYLOAD_TOO_LARGE', 'Илгээсэн өгөгдөл хэт том байна')

  const { path } = await context.params
  const target = `${apiBase()}/api/v1/${path.map(encodeURIComponent).join('/')}${request.nextUrl.search}`

  const headers = new Headers()
  request.headers.forEach((value, key) => {
    if (!HOP_BY_HOP.has(key.toLowerCase())) headers.set(key, value)
  })
  // undici-д шахалтгүй хариу хүснэ — дамжуулахдаа content-encoding-ийг дахин тооцохгүй.
  headers.delete('accept-encoding')

  const hasBody = request.method !== 'GET' && request.method !== 'HEAD' && request.body !== null
  // Content-Length-гүй (chunked) хүсэлтийг ч дамжуулах явцад тоолж зогсооно.
  let received = 0
  let tooLarge = false
  const body = hasBody
    ? request.body!.pipeThrough(
        new TransformStream<Uint8Array, Uint8Array>({
          transform(chunk, controller) {
            received += chunk.byteLength
            if (received > MAX_BODY_BYTES) {
              tooLarge = true
              controller.error(new Error('payload too large'))
            } else {
              controller.enqueue(chunk)
            }
          },
        }),
      )
    : undefined
  let upstream: Response
  try {
    upstream = await fetch(target, {
      method: request.method,
      headers,
      body,
      // Stream-ээр дамжуулахад Node-ийн fetch шаарддаг.
      ...(hasBody ? { duplex: 'half' } : {}),
      redirect: 'manual',
      cache: 'no-store',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    } as RequestInit)
  } catch (error) {
    if (tooLarge) return json(413, 'PAYLOAD_TOO_LARGE', 'Илгээсэн өгөгдөл хэт том байна')
    if (error instanceof DOMException && error.name === 'TimeoutError') {
      return json(504, 'GATEWAY_TIMEOUT', 'Сервер хариу өгөхгүй удаж байна. Түр хүлээгээд дахин оролдоно уу.')
    }
    return json(502, 'BAD_GATEWAY', 'Сервертэй холбогдож чадсангүй. Түр хүлээгээд дахин оролдоно уу.')
  }

  const responseHeaders = new Headers()
  upstream.headers.forEach((value, key) => {
    const name = key.toLowerCase()
    if (!HOP_BY_HOP.has(name) && name !== 'content-encoding' && name !== 'content-length') responseHeaders.set(key, value)
  })
  return new Response(upstream.body, { status: upstream.status, headers: responseHeaders })
}

export { forward as GET, forward as POST, forward as PUT, forward as DELETE }
