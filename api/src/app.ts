import express from 'express'
import helmet from 'helmet'
import { errorHandler, notFound } from './middleware/errorHandler.js'
import { verifyRateLimiter } from './middleware/rateLimiter.js'
import { statementVerifyRouter } from './modules/statement/statement.public.router.js'
import { statementRouter } from './modules/statement/statement.router.js'

export function createApp() {
  const app = express()
  // Хөтөч зөвхөн вэбээр (Next.js) дамжиж ирнэ — тэр нэг hop л X-Forwarded-For-ийн сүүлийн утгыг бичдэг
  // (web/proxy.ts хэрэглэгчийн илгээснийг хасна). Хаягийн хүрээгээр итгэвэл LAN-ийн хэрэглэгч
  // (мөн хувийн хаягтай) толгойг хуурамчаар илгээж хязгаар, аудитын IP-г тойрно.
  app.set('trust proxy', 1)
  app.disable('x-powered-by')
  app.use(helmet())
  // 10,000 мөр × 16 багана ~1.5MB (STATEMENT_LIMITS-ийн тайлбар)
  app.use(express.json({ limit: '2mb' }))

  app.get('/health', (_req, res) => {
    res.json({ success: true, data: { status: 'ok' } })
  })
  app.use('/api/v1/public/statement-reports', verifyRateLimiter, statementVerifyRouter)
  app.use('/api/v1', statementRouter)

  app.use(notFound)
  app.use(errorHandler)
  return app
}
