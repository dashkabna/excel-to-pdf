import axios from 'axios'
import { toast } from 'sonner'

type ApiErrorShape = { error?: { message?: string; code?: string }; message?: string }

export const NETWORK_ERROR_MESSAGE = 'Сервертэй холбогдож чадсангүй. Түр хүлээгээд дахин оролдоно уу.'

/** UI зөвхөн монгол — axios/хөтчийн англи мессежийг ("Request failed with status code 500") харуулахгүй. */
const isMongolian = (text: string) => /[\u0400-\u04FF]/.test(text)

export function getApiErrorMessage(error: unknown, fallback: string): string {
  if (axios.isAxiosError(error)) {
    const data = error.response?.data as ApiErrorShape | string | undefined
    const message = data && typeof data === 'object' ? (data.error?.message ?? data.message) : undefined
    if (typeof message === 'string' && message.length > 0) return message
    if (!error.response || error.code === 'ERR_NETWORK') return NETWORK_ERROR_MESSAGE
    return fallback
  }
  if (error instanceof Error && error.message && isMongolian(error.message)) return error.message
  return fallback
}

function getApiErrorDetails(error: unknown): string | undefined {
  if (!axios.isAxiosError(error)) return undefined
  const data = error.response?.data as ApiErrorShape | string | undefined
  const code = data && typeof data === 'object' ? (data.error?.code ?? null) : null
  const parts = [error.response?.status ? `HTTP ${error.response.status}` : null, code].filter(Boolean)
  return parts.length > 0 ? parts.join(' · ') : undefined
}

export function toastApiError(error: unknown, fallback: string): void {
  const description = getApiErrorDetails(error)
  toast.error(getApiErrorMessage(error, fallback), description ? { description } : undefined)
}
