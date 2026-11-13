import { access, constants, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { createApp } from './app.js'
import { env } from './config/env.js'
import { logger } from './lib/logger.js'

/** DATA_DIR-д бичиж чадахгүй бол PDF/лого бүр 500 өгнө — эхлэхэд л тодорхой алдаатай зогсооно. */
async function assertDataDirWritable() {
  const dir = path.resolve(env.DATA_DIR)
  try {
    await mkdir(dir, { recursive: true })
    await access(dir, constants.W_OK)
  } catch (error) {
    logger.error(`DATA_DIR (${dir}) хавтсанд бичих эрхгүй байна — volume-ийн эзэмшигчийг шалгана уу`, {
      message: (error as Error).message,
    })
    process.exit(1)
  }
}

await assertDataDirWritable()
const app = createApp()
app.listen(env.PORT, () => {
  logger.info(`Statement API started on http://localhost:${env.PORT}`, { dataDir: env.DATA_DIR })
})
