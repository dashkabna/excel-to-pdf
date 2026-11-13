import type { Response } from 'express'

type Meta = {
  page?: number
  total?: number
  limit?: number
}

const jsonReplacer = (_key: string, value: unknown) => {
  if (typeof value === 'bigint') {
    const asNumber = Number(value)
    return Number.isSafeInteger(asNumber) ? asNumber : value.toString()
  }
  return value
}

const normalizeForJson = (value: unknown): unknown => {
  if (value === undefined) return undefined
  return JSON.parse(JSON.stringify(value, jsonReplacer))
}

export const ok = <T>(res: Response, data: T, meta?: Meta): Response => {
  const normalizedData = normalizeForJson(data)
  const normalizedMeta = meta ? (normalizeForJson(meta) as Meta) : undefined
  if (meta) {
    return res.json({ success: true, data: normalizedData, meta: normalizedMeta })
  }
  return res.json({ success: true, data: normalizedData })
}

export const fail = (res: Response, code: string, message: string, status = 400): Response =>
  res.status(status).json({ success: false, error: { code, message } })
