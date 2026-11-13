import axios from 'axios'
import type { HeaderLayoutPayload, VerificationPayload } from '@/features/statement/lib/statement-header-layout'

/**
 * Нэвтрэлтгүй апп — бүх хүсэлт ижил origin-ий `/api/v1` руу явж, Next.js сервер API руу дамжуулна
 * (app/api/v1/[...path]/route.ts).
 */
const api = axios.create({ baseURL: '/api/v1' })

export type StatementVerification = {
  code: string
  title: string | null
  generatedAt: string
  pageCount: number | null
  rowCount: number | null
  pdfSha256: string | null
}

export type StatementReportPayload = {
  title: string
  headerFields: Array<{ label: string; value: string }>
  /** Логоны доор харагдах байгууллагын мэдээлэл — мөр бүр тусдаа. */
  logoLines: string[]
  periodStart: string
  periodEnd: string
  orientation: 'portrait' | 'landscape'
  columns: Array<{ label: string; align: 'left' | 'center' | 'right'; width: number }>
  rows: string[][]
  beforeRows: Array<{ label: string; cells: string[] }>
  afterRows: Array<{ label: string; cells: string[] }>
  sourceFileName: string
  /** Толгойн дизайнерын байрлал (pt); өгөхгүй бол сервер автоматаар байрлуулна. */
  headerLayout?: HeaderLayoutPayload
  /** Баталгаажуулах QR блок; өгөхгүй бол PDF-д QR гарахгүй. */
  verification?: VerificationPayload
  /**
   * Урьдчилан харагдацад ашигласан логоны SHA-256 (лого байгаагүй бол null). Нэвтрэлтгүй тул
   * хэн ч логог сольж болно — зөрвөл сервер 409 буцааж, хуучин логотой PDF гарахаас сэргийлнэ.
   */
  logoSha256: string | null
}

export type StatementLogoFile = { blob: Blob; sha256: string | null }

/** `responseType: 'blob'` үед алдааны JSON ч Blob болж ирдэг — мессежийг нь сэргээнэ. */
async function unwrapBlobError(error: unknown) {
  if (axios.isAxiosError(error) && error.response?.data instanceof Blob) {
    try {
      error.response.data = JSON.parse(await error.response.data.text())
    } catch {
      // JSON биш бол (жишээ нь proxy-ийн HTML) статусын мессеж хэвээр үлдэнэ.
    }
  }
  return error
}

export const statementApi = {
  /** PDF дээрх QR-ийг уншсан хэн ч ашиглана. */
  verify: (code: string) =>
    api.get(`/public/statement-reports/${encodeURIComponent(code)}`).then((r) => r.data.data as StatementVerification),
  /** Байгууллагын лого (PNG) ба түүний SHA-256 (`X-Logo-Sha256`) — оруулаагүй бол null. */
  logo: async (): Promise<StatementLogoFile | null> => {
    try {
      const res = await api.get('/statement-report/logo', { responseType: 'blob' })
      const sha256 = res.headers['x-logo-sha256']
      return { blob: res.data as Blob, sha256: typeof sha256 === 'string' && sha256 ? sha256 : null }
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 404) return null
      throw await unwrapBlobError(error)
    }
  },
  uploadLogo: (file: File) => {
    const form = new FormData()
    form.append('file', file)
    return api
      .put('/statement-report/logo', form)
      .then((r) => r.data.data as { width: number; height: number; bytes: number; sha256: string })
  },
  deleteLogo: () => api.delete('/statement-report/logo').then((r) => r.data.data as { removed: boolean }),
  pdf: async (payload: StatementReportPayload) => {
    try {
      const res = await api.post('/statement-report/pdf', payload, { responseType: 'blob' })
      return res.data as Blob
    } catch (error) {
      throw await unwrapBlobError(error)
    }
  },
}
