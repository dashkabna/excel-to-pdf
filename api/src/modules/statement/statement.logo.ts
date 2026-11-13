import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { inflateSync } from 'node:zlib'
import PDFDocument from 'pdfkit'
import { PNG } from 'pngjs'
import { env } from '../../config/env.js'
import { AppError } from '../../lib/appError.js'
import { writeAuditLog } from '../../lib/audit.js'
import { sha256Hex } from './statement.verification.js'

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
export const LOGO_LIMITS = { bytes: 2 * 1024 * 1024, maxSide: 2000 } as const

/** PNG-ийн стандартаар color type бүрт зөвшөөрөгдөх битийн гүн ба сувгийн тоо. */
const COLOR_TYPES: Record<number, { depths: number[]; channels: number }> = {
  0: { depths: [1, 2, 4, 8, 16], channels: 1 },
  2: { depths: [8, 16], channels: 3 },
  3: { depths: [1, 2, 4, 8], channels: 1 },
  4: { depths: [8, 16], channels: 2 },
  6: { depths: [8, 16], channels: 4 },
}
const EMBED_TIMEOUT_MS = 5000

/**
 * Байгууллагын лого нэг л ширхэг — бүх хуулгын тайланд хэрэглэгдэнэ. DATA_DIR нь docker-т
 * volume тул дахин build/deploy-д устахгүй.
 */
export const uploadedLogoPath = () => path.resolve(env.DATA_DIR, 'logo.png')

export const hasUploadedLogo = () => existsSync(uploadedLogoPath())

type PngHeader = { width: number; height: number; bitDepth: number; colorType: number }

/** PNG-ийн гарын үсэг ба IHDR-ийг стандартын дагуу шалгана — өргөтгөл/MIME-д итгэхгүй. */
export function inspectPng(buffer: Buffer): PngHeader | null {
  if (buffer.length < 33 || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)) return null
  if (buffer.readUInt32BE(8) !== 13 || buffer.toString('latin1', 12, 16) !== 'IHDR') return null
  const width = buffer.readUInt32BE(16)
  const height = buffer.readUInt32BE(20)
  const bitDepth = buffer[24]!
  const colorType = buffer[25]!
  // Хуурамч битийн гүн (жишээ нь 255) задлах хэмжээний хязгаарыг олон дахин томсгодог тул хатуу шалгана.
  if (!COLOR_TYPES[colorType]?.depths.includes(bitDepth)) return null
  if (buffer[26] !== 0 || buffer[27] !== 0 || buffer[28]! > 1) return null
  return width > 0 && height > 0 ? { width, height, bitDepth, colorType } : null
}

/**
 * Бүх IDAT-ийг нийлүүлж задлахад зургийн хэмжээнээс хэтрэхгүй эсэхийг шалгана —
 * 2MB файл гигабайт болж санах ой дүүргэхээс (zip bomb) өмнө зогсооно.
 */
function pngDataInflates(buffer: Buffer, header: PngHeader): boolean {
  const { channels } = COLOR_TYPES[header.colorType]!
  const rawBytes = header.height * (1 + Math.ceil((header.width * channels * header.bitDepth) / 8))
  const maxOutputLength = Math.ceil(rawBytes * 1.25) + 1024
  const parts: Buffer[] = []
  let offset = 8
  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset)
    const type = buffer.toString('latin1', offset + 4, offset + 8)
    const end = offset + 12 + length
    if (end > buffer.length) return false
    if (type === 'IDAT') parts.push(buffer.subarray(offset + 8, offset + 8 + length))
    if (type === 'IEND') break
    offset = end
  }
  if (parts.length === 0) return false
  try {
    return inflateSync(Buffer.concat(parts), { maxOutputLength }).length > 0
  } catch {
    return false
  }
}

/**
 * pdfkit-ийн PNG задлагч (png-js) нь бага битийн палитр+tRNS, саарал+tRNS, 256 өнгөт
 * палитр, RGBA доторх PLTE зэргийг буруу зурдаг — урьдчилан харагдац зөв, PDF эвдэрсэн
 * гарна. Тиймээс хадгалахаас өмнө бүрэн задалж (pngjs) 8 бит RGBA болгон дахин кодлоно:
 * PDF ба урьдчилан харагдац яг ижил пикселийг зурна.
 */
function normalizePng(buffer: Buffer): Buffer {
  const decoded = PNG.sync.read(buffer)
  return PNG.sync.write(decoded, { colorType: 6, inputColorType: 6, bitDepth: 8, inputHasAlpha: true })
}

/**
 * pdfkit-ээр жижиг PDF-д оруулж үзнэ. png-js нь алдааг zlib callback дотроос шиддэг тул
 * promise хэзээ ч шийдэгдэхгүй байж болзошгүй — хугацааны хязгаараар 422 болгоно.
 */
async function assertEmbeddable(buffer: Buffer) {
  let timer: NodeJS.Timeout | undefined
  const embed = new Promise<void>((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: [50, 50] })
      doc.on('data', () => undefined)
      doc.on('end', resolve)
      doc.on('error', reject)
      doc.image(buffer, 0, 0, { fit: [40, 40] })
      doc.end()
    } catch (error) {
      reject(error)
    }
  })
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('embed timeout')), EMBED_TIMEOUT_MS)
  })
  try {
    await Promise.race([embed, timeout])
  } finally {
    clearTimeout(timer)
  }
}

/** Нэвтрэлтгүй (одоогоор) — аудитад IP л хадгална. */
type Actor = { ip?: string | null }

/**
 * Лого солих/устгахыг нэг нэгээр нь гүйцэтгэнэ: нэвтрэлтгүй тул зэрэг ирсэн хүсэлтүүд аудитын
 * мөр ба бодит файлын дарааллыг холих ёсгүй (мөр бүр яг тэр мөчийн логотой таарна).
 */
let queue: Promise<unknown> = Promise.resolve()
const serialized = <T>(task: () => Promise<T>): Promise<T> => {
  const run = queue.then(task, task)
  queue = run.catch(() => undefined)
  return run
}

export const statementLogoService = {
  async read(): Promise<Buffer | null> {
    try {
      return await readFile(uploadedLogoPath())
    } catch {
      return null
    }
  },

  save(upload: Buffer, actor: Actor) {
    return serialized(() => saveLogo(upload, actor))
  },

  remove(actor: Actor) {
    return serialized(() => removeLogo(actor))
  },
}

async function saveLogo(upload: Buffer, actor: Actor) {
  const header = inspectPng(upload)
  if (!header) throw new AppError('VALIDATION_ERROR', 'Зөвхөн PNG зураг оруулна уу', 422)
  if (header.width > LOGO_LIMITS.maxSide || header.height > LOGO_LIMITS.maxSide) {
    throw new AppError('VALIDATION_ERROR', `Логоны хэмжээ ${LOGO_LIMITS.maxSide}px-ээс ихгүй байх ёстой`, 422)
  }
  let normalized: Buffer
  try {
    if (!pngDataInflates(upload, header)) throw new Error('corrupt IDAT')
    normalized = normalizePng(upload)
    await assertEmbeddable(normalized)
  } catch {
    throw new AppError('VALIDATION_ERROR', 'PNG файлыг уншиж чадсангүй — файл эвдэрсэн байж магадгүй', 422)
  }

  const target = uploadedLogoPath()
  await mkdir(path.dirname(target), { recursive: true })
  // Тайлан зэрэг үүсэж байхад хагас бичигдсэн файл уншигдахгүйн тулд эхлээд түр файлд бичнэ.
  const temp = `${target}.${randomUUID()}.tmp`
  await writeFile(temp, normalized)

  const result = { width: header.width, height: header.height, bytes: normalized.length, sha256: sha256Hex(normalized) }
  try {
    // Аудитын мөр бичигдээгүй бол лого солигдохгүй — бүх тайланд нөлөөлөх өөрчлөлт бүр бүртгэлтэй байна.
    await writeAuditLog({
      action: 'UPDATE',
      entityType: 'StatementLogo',
      data: { ...result, uploadedBytes: upload.length },
      ip: actor.ip ?? null,
    })
  } catch (error) {
    await rm(temp, { force: true })
    throw error
  }
  try {
    await rename(temp, target)
  } catch (error) {
    await rm(temp, { force: true })
    // Аудитад UPDATE бичигдсэн ч лого солигдоогүйг тэмдэглэнэ.
    await writeAuditLog({ action: 'UPDATE_FAILED', entityType: 'StatementLogo', data: { sha256: result.sha256 }, ip: actor.ip ?? null }).catch(() => undefined)
    throw error
  }
  return result
}

/** Лого байхгүй бол юу ч хийхгүй, аудитад худал "устгасан" мөр үлдээхгүй. */
async function removeLogo(actor: Actor) {
  const target = uploadedLogoPath()
  const exists = await stat(target).then(
    () => true,
    () => false,
  )
  if (!exists) return { removed: false }
  await writeAuditLog({ action: 'DELETE', entityType: 'StatementLogo', ip: actor.ip ?? null })
  await rm(target, { force: true })
  return { removed: true }
}
