import { createReadStream } from 'node:fs'
import { appendFile, mkdir, open } from 'node:fs/promises'
import path from 'node:path'
import { createInterface } from 'node:readline'
import { env } from '../config/env.js'

/**
 * Өгөгдлийн сангүй (одоогоор) тул үйлдэл бүрийг DATA_DIR/audit.jsonl-д мөр мөрөөр нэмнэ:
 * тайлангийн баталгаажуулах бүртгэл (код, PDF-ийн SHA-256) ба логоны өөрчлөлт. Нэвтрэлтгүй тул
 * хэрэглэгчийн оронд IP хадгална. Дараа нь өгөгдлийн сан руу импортлох боломжтой.
 */
export type AuditEntry = {
  at: string
  action: string
  entityType: string
  entityId: string | null
  data: unknown
  ip: string | null
}

type AuditInput = Omit<AuditEntry, 'at' | 'entityId' | 'data' | 'ip'> & {
  entityId?: string | null
  data?: unknown
  ip?: string | null
}

export const auditFile = () => path.resolve(env.DATA_DIR, 'audit.jsonl')

const keyOf = (entityType: string, entityId: string, action: string) => `${action}\u0000${entityType}\u0000${entityId}`

/**
 * Кодоор шалгах нийтийн хүсэлт бүрт бүх файлыг уншихгүйн тулд (нэвтрэлтгүй, файл томорсоор)
 * entityId-тай мөрүүдийн индексийг анх хэрэгтэй үед нэг удаа мөр мөрөөр уншиж үүсгээд, шинэ
 * мөр бүрийг нэмнэ. Файл (DATA_DIR) солигдвол индексийг шинэчилнэ.
 */
let index: { file: string; entries: Map<string, AuditEntry> } | null = null
let loading: Promise<Map<string, AuditEntry>> | null = null

async function loadIndex(file: string): Promise<Map<string, AuditEntry>> {
  const entries = new Map<string, AuditEntry>()
  let stream
  try {
    stream = createReadStream(file, { encoding: 'utf8' })
    await new Promise<void>((resolve, reject) => {
      stream!.once('open', () => resolve())
      stream!.once('error', reject)
    })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return entries
    throw error
  }
  for await (const line of createInterface({ input: stream, crlfDelay: Infinity })) {
    const entry = parseLine(line)
    if (entry?.entityId) entries.set(keyOf(entry.entityType, entry.entityId, entry.action), entry)
  }
  return entries
}

function parseLine(line: string): AuditEntry | null {
  if (!line.trim()) return null
  try {
    const entry = JSON.parse(line) as AuditEntry
    return entry && typeof entry.entityType === 'string' && typeof entry.action === 'string' ? entry : null
  } catch {
    // Тасарсан мөр бусад бүртгэлийг уншихад саад болохгүй.
    return null
  }
}

async function getIndex(): Promise<Map<string, AuditEntry>> {
  const file = auditFile()
  if (index?.file === file) return index.entries
  loading ??= loadIndex(file).then(
    (entries) => {
      index = { file, entries }
      loading = null
      return entries
    },
    (error) => {
      loading = null
      throw error
    },
  )
  return loading
}

/** Тасарсан (диск дүүрсэн) сүүлийн мөрийн араас шинэ мөр наалдахгүйн тулд бичилт бүрийн өмнө шалгана. */
async function ensureTrailingNewline(file: string) {
  try {
    const handle = await open(file, 'r')
    try {
      const { size } = await handle.stat()
      if (size > 0) {
        const last = Buffer.alloc(1)
        await handle.read(last, 0, 1, size - 1)
        if (last[0] !== 0x0a) await appendFile(file, '\n', 'utf8')
      }
    } finally {
      await handle.close()
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
}

export async function writeAuditLog(input: AuditInput): Promise<void> {
  const entry: AuditEntry = {
    at: new Date().toISOString(),
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId ?? null,
    data: input.data ?? null,
    ip: input.ip ?? null,
  }
  const file = auditFile()
  await mkdir(path.dirname(file), { recursive: true })
  await ensureTrailingNewline(file)
  // O_APPEND-ээр нэг write — зэрэг ирсэн хүсэлтүүдийн мөр холилдохгүй.
  await appendFile(file, `${JSON.stringify(entry)}\n`, 'utf8')
  if (entry.entityId && index?.file === file) index.entries.set(keyOf(entry.entityType, entry.entityId, entry.action), entry)
}

/** entityType/entityId/action-ээр хамгийн сүүлийн мөр; байхгүй бол null. */
export async function findAuditEntry(entityType: string, entityId: string, action: string): Promise<AuditEntry | null> {
  return (await getIndex()).get(keyOf(entityType, entityId, action)) ?? null
}

/** Тест: DATA_DIR/файл солигдсоны дараа индексийг дахин уншуулна. */
export function resetAuditIndex() {
  index = null
  loading = null
}
