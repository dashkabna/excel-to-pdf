import { createHash, randomBytes } from 'node:crypto'
import { publicWebUrl } from '../../config/env.js'

/**
 * Crockford base32 — I, L, O, U байхгүй тул гараар бичихэд андуурахгүй.
 * 16 тэмдэгт = 80 бит санамсаргүй: таамаглаж олох боломжгүй, гэхдээ уншиж бичихэд богино.
 */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
export const VERIFICATION_CODE_PATTERN = /^[0-9A-HJKMNP-TV-Z]{16}$/

export function createVerificationCode(): string {
  let out = ''
  let buffer = 0
  let bits = 0
  for (const byte of randomBytes(10)) {
    buffer = ((buffer << 8) | byte) & 0xffff
    bits += 8
    while (bits >= 5) {
      out += ALPHABET[(buffer >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  return out
}

/** Хэрэглэгчийн бичсэн кодыг (жижиг үсэг, зураас, зай, O/I/L андуурал) хэвийн болгоно. */
export const normalizeVerificationCode = (raw: string) =>
  raw
    .toUpperCase()
    .replace(/[\s-]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1')

export const formatVerificationCode = (code: string) => code.match(/.{1,4}/g)?.join('-') ?? code

export const verificationBaseUrl = () => `${publicWebUrl()}/verify`

export const verificationUrl = (code: string) => `${verificationBaseUrl()}/${code}`

/** QR-ийн холбоосын загвар дахь энэ тэмдэглэгээ тайлангийн кодоор солигдоно. */
export const QR_CODE_TOKEN = '{код}'
export const QR_LINK_MAX = 300
export const defaultQrLink = () => `${verificationBaseUrl()}/${QR_CODE_TOKEN}`

/**
 * Холбоосын алдаа (null — зөв). Вэбийн qrLinkError (statement-header-layout.ts)-тэй үг үсгээрээ
 * ижил — api тест хоёуланг тулгадаг. Зөвхөн https, нэвтрэх мэдээлэлгүй, зөвшөөрсөн домэйн.
 */
export function qrLinkError(link: string, allowedHosts: string[]): string | null {
  const value = link.trim()
  if (!value) return 'QR холбоос оруулна уу'
  if (value.length > QR_LINK_MAX) return `QR холбоос ${QR_LINK_MAX} тэмдэгтээс хэтэрсэн`
  let url: URL
  try {
    url = new URL(value.split(QR_CODE_TOKEN).join('ABCDEFGHJKMNPQRS'))
  } catch {
    return 'QR холбоос буруу байна'
  }
  if (url.protocol !== 'https:') return 'QR холбоос https:// хаягаар эхлэх ёстой'
  if (url.username || url.password) return 'QR холбоос буруу байна'
  const host = url.hostname.toLowerCase()
  const hosts = allowedHosts.map((h) => h.toLowerCase())
  if (!hosts.some((allowed) => host === allowed || host.endsWith(`.${allowed}`))) {
    return `QR холбоос зөвхөн ${allowedHosts.join(', ')} домэйн дээрх хаяг байна`
  }
  return null
}

/** QR-д орох бодит хаяг — `{код}`-ийг тайлангийн кодоор сольсон. */
export const qrUrl = (link: string, code: string) => link.trim().split(QR_CODE_TOKEN).join(code)

/** Тайлбарын `{хаяг}` — холбоосын хаяг (кодгүй): origin + зам, төгсгөлийн "/"-гүй. */
export function qrAddress(link: string): string {
  try {
    const url = new URL(link.trim().split(QR_CODE_TOKEN).join(''))
    return `${url.origin}${url.pathname}`.replace(/\/+$/, '')
  } catch {
    return verificationBaseUrl()
  }
}

export const sha256Hex = (data: Buffer) => createHash('sha256').update(data).digest('hex')
