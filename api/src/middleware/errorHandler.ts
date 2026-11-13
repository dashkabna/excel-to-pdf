import type { NextFunction, Request, Response } from 'express'
import { ZodError } from 'zod'
import { AppError } from '../lib/appError.js'
import { logger } from '../lib/logger.js'

export const errorHandler = (err: Error, req: Request, res: Response, _next: NextFunction): Response => {
  const context = { method: req.method, path: req.originalUrl || req.url, ip: req.ip }
  if (err instanceof AppError) {
    logger.warn('AppError', { ...context, code: err.code, statusCode: err.statusCode, message: err.message })
    return res.status(err.statusCode).json({ success: false, error: { code: err.code, message: err.message } })
  }
  if (err instanceof ZodError) {
    return res.status(422).json({
      success: false,
      error: { code: 'VALIDATION_ERROR', message: err.issues.map((issue) => issue.message).join(', ') },
    })
  }
  // express.json, router-ийн (http-errors) хэрэглэгчийн алдаа — 500 биш, stack-гүйгээр бүртгэнэ.
  const status = (err as { status?: number; statusCode?: number }).status ?? (err as { statusCode?: number }).statusCode
  if (typeof status === 'number' && status >= 400 && status < 500 && (err as { expose?: boolean }).expose !== false) {
    const type = (err as { type?: string }).type
    const [code, message] =
      status === 413
        ? ['PAYLOAD_TOO_LARGE', 'Илгээсэн өгөгдөл хэт том байна']
        : status === 415
          ? ['UNSUPPORTED_MEDIA_TYPE', 'Илгээсэн өгөгдлийн төрөл дэмжигдэхгүй']
          : type === 'entity.parse.failed'
            ? ['BAD_REQUEST', 'JSON буруу байна']
            : ['BAD_REQUEST', 'Хүсэлт буруу байна']
    logger.warn('ClientError', { ...context, status, type, message: err.message })
    return res.status(status).json({ success: false, error: { code, message } })
  }
  logger.error('Unhandled error', { ...context, name: err.name, message: err.message, stack: err.stack })
  return res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: 'Серверийн алдаа гарлаа' } })
}

export const notFound = (_req: Request, res: Response) =>
  res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Олдсонгүй' } })
