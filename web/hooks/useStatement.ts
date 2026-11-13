'use client'

import axios from 'axios'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { toastApiError } from '@/lib/toast'
import { statementApi, type StatementReportPayload } from '@/lib/api/statement.api'

const STATEMENT_LOGO_KEY = ['statement-logo'] as const

/**
 * Хуулгын тайлан — PDF-ийг серверт үүсгэж Blob-оор буцаана (татах нь дуудагчийн ажил). Өөр хэрэглэгч
 * логог сольсон бол (409 LOGO_CHANGED) логог дахин ачаалж урьдчилан харагдацыг шинэчилнэ.
 */
export const useStatementReportPdf = () => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: StatementReportPayload) => statementApi.pdf(payload),
    onError: (error) => {
      if (axios.isAxiosError(error) && error.response?.status === 409) {
        void qc.invalidateQueries({ queryKey: STATEMENT_LOGO_KEY })
      }
      toastApiError(error, 'PDF үүсгэх үед алдаа гарлаа')
    },
  })
}

/** 404 нь "бүртгэлгүй" гэсэн хариу — дахин оролдох шаардлагагүй. */
export const useStatementVerification = (code: string) =>
  useQuery({
    queryKey: ['statement-verification', code],
    queryFn: () => statementApi.verify(code),
    enabled: code.length > 0,
    retry: false,
    staleTime: 5 * 60 * 1000,
  })

export type StatementLogo = { src: string; width: number; height: number; sha256: string | null }

/** Blob-ийг data URL болгоно — object URL шиг цэвэрлэх шаардлагагүй, cache-д аюулгүй. */
const blobToLogo = (blob: Blob, sha256: string | null) =>
  new Promise<StatementLogo>((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error)
    reader.onload = () => {
      const src = String(reader.result)
      const image = new Image()
      image.onload = () => resolve({ src, width: image.naturalWidth, height: image.naturalHeight, sha256 })
      image.onerror = () => reject(new Error('Логог уншиж чадсангүй'))
      image.src = src
    }
    reader.readAsDataURL(blob)
  })

export const useStatementLogo = () =>
  useQuery({
    queryKey: STATEMENT_LOGO_KEY,
    queryFn: async () => {
      const file = await statementApi.logo()
      return file ? blobToLogo(file.blob, file.sha256) : null
    },
    // Нэвтрэлтгүй тул хэн ч логог сольж болно — цонх руу буцахад шинэчилнэ; зөрвөл сервер 409 өгнө.
    staleTime: 30 * 1000,
  })

export const useStatementLogoMutations = () => {
  const qc = useQueryClient()
  const invalidate = () => qc.invalidateQueries({ queryKey: STATEMENT_LOGO_KEY })
  const upload = useMutation({
    mutationFn: (file: File) => statementApi.uploadLogo(file),
    onSuccess: () => {
      invalidate()
      toast.success('Лого шинэчлэгдлээ')
    },
    onError: (error) => toastApiError(error, 'Лого оруулах үед алдаа гарлаа'),
  })
  const remove = useMutation({
    mutationFn: () => statementApi.deleteLogo(),
    onSuccess: () => {
      invalidate()
      toast.success('Лого устгагдлаа')
    },
    onError: (error) => toastApiError(error, 'Лого устгах үед алдаа гарлаа'),
  })
  return { upload, remove }
}
