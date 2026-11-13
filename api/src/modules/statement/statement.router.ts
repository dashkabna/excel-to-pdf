import { Router } from 'express'
import type { Request, RequestHandler, Response } from 'express'
import multer, { MulterError } from 'multer'
import { AppError } from '../../lib/appError.js'
import { ok } from '../../lib/response.js'
import { logoRateLimiter, pdfRateLimiter } from '../../middleware/rateLimiter.js'
import { validate } from '../../middleware/validate.js'
import { STATEMENT_LIMITS, statementPdfSchema, type StatementPdfInput } from './statement.schema.js'
import { statementService } from './statement.service.js'
import { LOGO_LIMITS, statementLogoService } from './statement.logo.js'
import { QR_LINK_MAX, defaultQrLink, sha256Hex } from './statement.verification.js'
import { env } from '../../config/env.js'

/** Нэвтрэлтгүй (хэрэглэгчийн шийдвэр, 2026-11-13) — хүсэлтийг IP-ээр хязгаарлаж, аудитад IP хадгална. */
export const statementRouter = Router()

statementRouter.post('/statement-report/pdf', pdfRateLimiter, validate(statementPdfSchema), (async (req, res) => {
  const result = await statementService.generate(req.body as StatementPdfInput, { ip: req.ip ?? null })
  res.setHeader('Content-Type', 'application/pdf')
  res.setHeader('Content-Disposition', result.disposition)
  res.setHeader('Content-Length', String(result.buffer.length))
  res.setHeader('X-Page-Count', String(result.pageCount))
  res.setHeader('X-Verification-Code', result.verificationCode)
  res.setHeader('Cache-Control', 'no-store')
  res.end(result.buffer)
}) as RequestHandler)

// Нэвтрэлтгүй тул текст талбар, олон хэсэгтэй multipart-аар санах ой дүүргэхээс сэргийлнэ.
const logoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: LOGO_LIMITS.bytes, files: 1, fields: 0, parts: 1, fieldSize: 1024, headerPairs: 20 },
})

const readLogoFile = (req: Request, res: Response) =>
  new Promise<Express.Multer.File>((resolve, reject) => {
    logoUpload.single('file')(req, res, (err) => {
      if (err instanceof MulterError && err.code === 'LIMIT_FILE_SIZE') {
        return reject(new AppError('VALIDATION_ERROR', 'Логоны файл 2MB-аас ихгүй байх ёстой', 413))
      }
      if (err) return reject(new AppError('VALIDATION_ERROR', 'Логоны файлыг хүлээн авч чадсангүй', 422))
      if (!req.file) return reject(new AppError('VALIDATION_ERROR', 'PNG файл сонгоно уу', 422))
      resolve(req.file)
    })
  })

/** Вэбийн шалгалт серверийнхтэй ижил байхын тулд QR-ийн зөвшөөрсөн домэйн, хязгаарыг өгнө. */
statementRouter.get('/statement-report/config', (_req, res) => {
  ok(res, {
    qrAllowedHosts: env.QR_ALLOWED_HOSTS,
    defaultQrLink: defaultQrLink(),
    limits: {
      verificationTextChars: STATEMENT_LIMITS.verificationTextChars,
      verificationTextLines: STATEMENT_LIMITS.verificationTextLines,
      qrLinkChars: QR_LINK_MAX,
      footerTextChars: STATEMENT_LIMITS.footerTextChars,
    },
  })
})

/** Урьдчилан харагдацад ашиглана. */
statementRouter.get('/statement-report/logo', (async (_req, res) => {
  const logo = await statementLogoService.read()
  if (!logo) throw new AppError('NOT_FOUND', 'Лого оруулаагүй байна', 404)
  res.setHeader('Content-Type', 'image/png')
  res.setHeader('Cache-Control', 'no-store')
  // Вэб PDF хүсэхдээ буцааж илгээнэ — урьдчилан харагдац ба PDF ижил логотой эсэхийг тулгана.
  res.setHeader('X-Logo-Sha256', sha256Hex(logo))
  res.end(logo)
}) as RequestHandler)

statementRouter.put('/statement-report/logo', logoRateLimiter, (async (req, res) => {
  const file = await readLogoFile(req, res)
  const result = await statementLogoService.save(file.buffer, { ip: req.ip ?? null })
  return ok(res, result)
}) as RequestHandler)

statementRouter.delete('/statement-report/logo', logoRateLimiter, (async (req, res) => {
  return ok(res, await statementLogoService.remove({ ip: req.ip ?? null }))
}) as RequestHandler)
