import type { NextFunction, Request, Response } from 'express'
import type { ZodObject, ZodRawShape } from 'zod'
import { AppError } from '../lib/appError.js'

export const validate =
  (schema: ZodObject<ZodRawShape>) =>
  (req: Request, _res: Response, next: NextFunction): void => {
    const parsed = schema.safeParse({
      body: req.body ?? {},
      params: req.params ?? {},
      query: req.query ?? {},
    })

    if (!parsed.success) {
      throw new AppError('VALIDATION_ERROR', parsed.error.issues.map((i) => i.message).join(', '), 422)
    }

    req.body = parsed.data.body
    Object.assign(req.params, parsed.data.params)
    Object.assign(req.query, parsed.data.query)
    next()
  }
