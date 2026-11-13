// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { GET, POST } from '@/app/api/v1/[...path]/route'
import { proxy } from '@/proxy'

const ctx = (...path: string[]) => ({ params: Promise.resolve({ path }) })

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('/api/v1 proxy route', () => {
  it('forwards to API_INTERNAL_URL (read at request time) with the client address and streams the answer back', async () => {
    vi.stubEnv('API_INTERNAL_URL', 'http://api.test:4000/')
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) =>
      new Response(new Uint8Array([37, 80, 68, 70]), {
        status: 200,
        headers: { 'content-type': 'application/pdf', 'x-page-count': '2', 'content-encoding': 'gzip', connection: 'keep-alive' },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const req = new NextRequest('http://web.test/api/v1/statement-report/pdf?x=1', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': '10.0.0.5', connection: 'close', expect: '100-continue' },
      body: JSON.stringify({ title: 'Тест' }),
    })
    const res = await POST(req, ctx('statement-report', 'pdf'))
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('http://api.test:4000/api/v1/statement-report/pdf?x=1')
    const sent = new Headers(init.headers)
    expect(sent.get('x-forwarded-for')).toBe('10.0.0.5')
    expect(sent.get('connection')).toBeNull()
    expect(sent.get('expect')).toBeNull()
    expect(res.status).toBe(200)
    expect(res.headers.get('x-page-count')).toBe('2')
    expect(res.headers.get('content-encoding')).toBeNull()
    expect(Array.from(new Uint8Array(await res.arrayBuffer()))).toEqual([37, 80, 68, 70])
  })

  it('refuses bodies over 3MB with a Mongolian 413 before contacting the API', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const req = new NextRequest('http://web.test/api/v1/statement-report/pdf', {
      method: 'POST',
      headers: { 'content-length': String(3 * 1024 * 1024 + 1) },
      body: 'x',
    })
    const res = await POST(req, ctx('statement-report', 'pdf'))
    expect(res.status).toBe(413)
    expect((await res.json()).error.message).toBe('Илгээсэн өгөгдөл хэт том байна')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('answers 502 / 504 with Mongolian JSON when the API is down or too slow', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValueOnce(new TypeError('fetch failed')))
    const down = await GET(new NextRequest('http://web.test/api/v1/statement-report/logo'), ctx('statement-report', 'logo'))
    expect(down.status).toBe(502)
    expect((await down.json()).error.message).toContain('Сервертэй холбогдож чадсангүй')

    vi.stubGlobal('fetch', vi.fn().mockRejectedValueOnce(new DOMException('timeout', 'TimeoutError')))
    const slow = await GET(new NextRequest('http://web.test/api/v1/statement-report/logo'), ctx('statement-report', 'logo'))
    expect(slow.status).toBe(504)
  })
})

describe('proxy.ts', () => {
  it('drops a client-sent X-Forwarded-For so Next fills in the real socket address', () => {
    const res = proxy(new NextRequest('http://web.test/api/v1/x', { headers: { 'x-forwarded-for': '203.0.113.9', accept: 'application/json' } }))
    const kept = (res.headers.get('x-middleware-override-headers') ?? '').split(',')
    expect(kept).toContain('accept')
    expect(kept).not.toContain('x-forwarded-for')
  })

  it('keeps the header behind a trusted reverse proxy (BEHIND_PROXY=true)', () => {
    vi.stubEnv('BEHIND_PROXY', 'true')
    const res = proxy(new NextRequest('http://web.test/api/v1/x', { headers: { 'x-forwarded-for': '203.0.113.9' } }))
    expect(res.headers.get('x-middleware-override-headers')).toBeNull()
  })
})
