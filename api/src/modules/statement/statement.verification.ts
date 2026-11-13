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

export const sha256Hex = (data: Buffer) => createHash('sha256').update(data).digest('hex')
