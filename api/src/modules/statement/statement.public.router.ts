import { Router } from 'express'
import type { RequestHandler } from 'express'
import { z } from 'zod'
import { AppError } from '../../lib/appError.js'
import { ok } from '../../lib/response.js'
import { validate } from '../../middleware/validate.js'
import { statementService } from './statement.service.js'
import { VERIFICATION_CODE_PATTERN, normalizeVerificationCode } from './statement.verification.js'

const verifySchema = z.object({
  body: z.object({}).optional().default({}),
  params: z.object({
    code: z
      .string()
      .max(40)
      .transform(normalizeVerificationCode)
      .refine((code) => VERIFICATION_CODE_PATTERN.test(code), 'Баталгаажуулах код буруу байна'),
  }),
  query: z.object({}).optional().default({}),
})

/** Нийтэд нээлттэй — QR уншсан хэн ч шалгана. */
export const statementVerifyRouter = Router()

statementVerifyRouter.get('/:code', validate(verifySchema), (async (req, res) => {
  const result = await statementService.verify(String(req.params.code))
  if (!result) throw new AppError('NOT_FOUND', 'Энэ кодтой тайлан бүртгэгдээгүй байна', 404)
  res.setHeader('Cache-Control', 'no-store')
  return ok(res, result)
}) as RequestHandler)
