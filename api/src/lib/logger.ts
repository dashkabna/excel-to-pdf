const isProduction = process.env.NODE_ENV === 'production'

type LogLevel = 'debug' | 'info' | 'warn' | 'error'

const LEVEL_COLORS: Record<LogLevel, string> = {
  debug: '\x1b[36m', // cyan
  info: '\x1b[32m',  // green
  warn: '\x1b[33m',  // yellow
  error: '\x1b[31m', // red
}

const RESET = '\x1b[0m'

const formatDev = (level: LogLevel, message: string, meta?: Record<string, unknown>): string => {
  const timestamp = new Date().toISOString()
  const color = LEVEL_COLORS[level]
  const metaStr = meta && Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta)}` : ''
  return `${color}[${timestamp}] ${level.toUpperCase()}${RESET} ${message}${metaStr}`
}

const formatProd = (level: LogLevel, message: string, meta?: Record<string, unknown>): string => {
  return JSON.stringify({
    level,
    message,
    timestamp: new Date().toISOString(),
    ...meta,
  })
}

const log = (level: LogLevel, message: string, meta?: Record<string, unknown>): void => {
  const output = isProduction ? formatProd(level, message, meta) : formatDev(level, message, meta)

  switch (level) {
    case 'debug':
      // eslint-disable-next-line no-console
      console.debug(output)
      break
    case 'info':
      // eslint-disable-next-line no-console
      console.info(output)
      break
    case 'warn':
      // eslint-disable-next-line no-console
      console.warn(output)
      break
    case 'error':
      // eslint-disable-next-line no-console
      console.error(output)
      break
  }
}

export const logger = {
  debug: (message: string, meta?: Record<string, unknown>) => log('debug', message, meta),
  info: (message: string, meta?: Record<string, unknown>) => log('info', message, meta),
  warn: (message: string, meta?: Record<string, unknown>) => log('warn', message, meta),
  error: (message: string, meta?: Record<string, unknown>) => log('error', message, meta),
}
