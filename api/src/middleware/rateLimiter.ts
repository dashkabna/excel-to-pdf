import rateLimit from 'express-rate-limit'
import { env } from '../config/env.js'

/** Тест суит олон хүсэлт илгээдэг — хязгаарыг тусдаа тестээр шалгана. */
const skip = () => env.NODE_ENV === 'test'

const message = (text: string) => ({ success: false, error: { code: 'TOO_MANY_REQUESTS', message: text } })

/** Нэвтрэлтгүй тул PDF үүсгэх (CPU их), лого солих хүсэлтийг IP-ээр хязгаарлана. */
export const pdfRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: true,
  skip,
  legacyHeaders: false,
  message: message('Хэт олон тайлан үүсгэлээ. Түр хүлээгээд дахин оролдоно уу.'),
})

export const logoRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 10,
  standardHeaders: true,
  skip,
  legacyHeaders: false,
  message: message('Логог хэт олон удаа солилоо. Түр хүлээнэ үү.'),
})

export const verifyRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 60,
  standardHeaders: true,
  skip,
  legacyHeaders: false,
  message: message('Хэт олон шалгалт хийлээ. Түр хүлээнэ үү.'),
})
