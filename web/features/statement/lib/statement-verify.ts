import { sha256 } from '@noble/hashes/sha2'

/** API-ийн verification модуль-тэй ижил — Crockford base32, 16 тэмдэгт. */
export const VERIFICATION_CODE_PATTERN = /^[0-9A-HJKMNP-TV-Z]{16}$/

/** Хэрэглэгчийн бичсэн кодыг (жижиг үсэг, зураас, зай, O/I/L андуурал) хэвийн болгоно. */
export const normalizeVerificationCode = (raw: string) =>
  raw
    .toUpperCase()
    .replace(/[\s-]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1')

export const formatVerificationCode = (code: string) => code.match(/.{1,4}/g)?.join('-') ?? code

const toHex = (bytes: Uint8Array) => Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')

/**
 * Файлыг хөтөч дотор хэшлэнэ — PDF серверт илгээгдэхгүй. crypto.subtle нь зөвхөн HTTPS/localhost
 * хуудсанд байдаг; апп LAN-д http-ээр ажилладаг тул бусад үед JS хэрэгжүүлэлтээр (@noble/hashes) тооцно.
 */
export async function sha256Hex(data: ArrayBuffer): Promise<string> {
  const subtle = typeof window !== 'undefined' && window.isSecureContext ? globalThis.crypto?.subtle : undefined
  if (subtle) return toHex(new Uint8Array(await subtle.digest('SHA-256', data)))
  return toHex(sha256(new Uint8Array(data)))
}

/** Сервер Улаанбаатарын цагаар PDF-д хэвлэдэг тул энд ч мөн адил харуулна. */
export const formatVerifiedAt = (iso: string) => {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ulaanbaatar',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date)
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? ''
  return `${get('year')}/${get('month')}/${get('day')} ${get('hour')}:${get('minute')}`
}
