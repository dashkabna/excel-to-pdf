import { describe, expect, it } from 'vitest'
import { AxiosError, AxiosHeaders } from 'axios'
import { NETWORK_ERROR_MESSAGE, getApiErrorMessage } from '@/lib/toast'

const headers = new AxiosHeaders()
const withResponse = (status: number, data: unknown) =>
  new AxiosError(`Request failed with status code ${status}`, 'ERR_BAD_RESPONSE', undefined, undefined, {
    status,
    data,
    statusText: '',
    headers,
    config: { headers },
  })

describe('getApiErrorMessage', () => {
  it('shows the server message when the API (or the web proxy) sends one', () => {
    expect(getApiErrorMessage(withResponse(422, { success: false, error: { code: 'VALIDATION_ERROR', message: 'Гарчиг оруулна уу' } }), 'x')).toBe(
      'Гарчиг оруулна уу',
    )
    expect(
      getApiErrorMessage(withResponse(504, { success: false, error: { code: 'GATEWAY_TIMEOUT', message: 'Сервер хариу өгөхгүй удаж байна.' } }), 'x'),
    ).toBe('Сервер хариу өгөхгүй удаж байна.')
  })

  it('never shows axios English text: network errors get a Mongolian message, other failures the fallback', () => {
    const network = new AxiosError('Network Error', 'ERR_NETWORK')
    expect(getApiErrorMessage(network, 'PDF үүсгэх үед алдаа гарлаа')).toBe(NETWORK_ERROR_MESSAGE)
    expect(getApiErrorMessage(withResponse(500, 'Internal Server Error'), 'PDF үүсгэх үед алдаа гарлаа')).toBe('PDF үүсгэх үед алдаа гарлаа')
    expect(getApiErrorMessage(withResponse(502, new Blob(['<html>'])), 'Лого оруулах үед алдаа гарлаа')).toBe('Лого оруулах үед алдаа гарлаа')
  })

  it('keeps Mongolian messages of local errors and hides English ones', () => {
    expect(getApiErrorMessage(new Error('Логог уншиж чадсангүй'), 'x')).toBe('Логог уншиж чадсангүй')
    expect(getApiErrorMessage(new TypeError('Failed to fetch'), 'Алдаа гарлаа')).toBe('Алдаа гарлаа')
  })
})
