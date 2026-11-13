import { AppError } from '../../lib/appError.js'
import { findAuditEntry, writeAuditLog } from '../../lib/audit.js'
import { statementLogoService } from './statement.logo.js'
import { formatStamp, renderStatementPdf, verificationBody } from './statement.pdf.js'
import type { StatementPdfInput } from './statement.schema.js'
import {
  createVerificationCode,
  formatVerificationCode,
  sha256Hex,
  defaultQrLink,
  qrAddress,
  qrUrl,
} from './statement.verification.js'

export const STATEMENT_AUDIT_ENTITY = 'StatementReport'

/** Нэвтрэлтгүй (одоогоор) — хэрэглэгчийн оронд IP. */
type Actor = { ip?: string | null }

/** RFC 5987 — `filename*`-д Кирилл нэрийг кодлоно. */
const encodeRfc5987 = (value: string) =>
  encodeURIComponent(value).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)

/** Хос бүрдэлгүй surrogate нь encodeURIComponent-д URIError өгдөг. */
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g

export const contentDisposition = (title: string, generatedAt: Date) => {
  const day = formatStamp(generatedAt).compact
  const normalized = title
    .replace(LONE_SURROGATE, '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\\/:*?"<>|\u0000-\u001F\u007F]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  // Code point-оор тайрна — UTF-16 нэгжээр тайрвал emoji-г хагалж URIError өгнө.
  const safeTitle = Array.from(normalized).slice(0, 80).join('').trim() || 'statement'
  return `attachment; filename="statement-${day}.pdf"; filename*=UTF-8''${encodeRfc5987(`${safeTitle}-${day}.pdf`)}`
}

export const statementService = {
  /**
   * PDF-ийг бүтнээр нь санах ойд үүсгэнэ — stream хийвэл дундаас алдаа гарахад
   * header аль хэдийн илгээгдсэн байж JSON алдааны хариу өгч чадахгүй.
   * Аудитын бичлэг амжилттай болсны дараа л файлыг буцаана.
   */
  async generate(input: StatementPdfInput, actor: Actor) {
    const generatedAt = new Date()
    // Аудитын мөр нь баталгаажуулах бүртгэл — код нь `entityId`, PDF-ийн хэш `data`-д.
    // Логог нэг удаа уншиж урьдчилан харагдацынхтай тулгана — өөр хэрэглэгч сольсон бол хуучин
    // байрлалаар шинэ лого хэвлэхийн оронд хэрэглэгчид дахин харуулна.
    const logo = await statementLogoService.read()
    if (input.logoSha256 !== undefined && (logo ? sha256Hex(logo) : null) !== input.logoSha256) {
      throw new AppError('LOGO_CHANGED', 'Лого өөрчлөгдсөн байна — урьдчилан харагдацыг шинэчлээд дахин оролдоно уу', 409)
    }
    const code = createVerificationCode()
    const link = input.verification?.link || defaultQrLink()
    const { buffer, pageCount } = await renderStatementPdf(input, {
      userName: null,
      logo,
      generatedAt,
      verification: { code, url: qrUrl(link, code), baseUrl: qrAddress(link) },
    })
    // Аудитын мөр зөвхөн файл буцаагдах үед үлдэх ёстой тул header-ийг түрүүлж бэлтгэнэ.
    const disposition = contentDisposition(input.title, generatedAt)

    await writeAuditLog({
      action: 'EXPORT',
      entityType: STATEMENT_AUDIT_ENTITY,
      entityId: code,
      data: {
        title: input.title,
        sourceFileName: input.sourceFileName || null,
        rowCount: input.rows.length,
        columnCount: input.columns.length,
        pageCount,
        generatedAt: generatedAt.toISOString(),
        pdfSha256: sha256Hex(buffer),
        hasVerificationQr: Boolean(input.verification),
        // QR-ийн хажууд яг хэвлэсэн тайлбар (өгөөгүй бол анхдагч) — хэн юу гэж бичиж хэвлэснийг бүртгэнэ.
        verificationText: input.verification ? verificationBody(qrAddress(link), input.verification.text).join('\n') : null,
        // QR-д орсон холбоос ба хэрэглэгчийн хөлийн текст — хаана заасан, юу бичсэнийг бүртгэнэ.
        qrUrl: input.verification ? qrUrl(link, code) : null,
        footerText: input.footerText || null,
      },
      ip: actor.ip ?? null,
    })

    return { buffer, pageCount, disposition, verificationCode: code }
  },

  /**
   * Нийтэд нээлттэй шалгалт: QR-ийг уншсан хэн ч хардаг тул хувийн
   * мэдээлэл (файлын нэр, IP) буцаахгүй.
   */
  async verify(code: string) {
    const record = await findAuditEntry(STATEMENT_AUDIT_ENTITY, code, 'EXPORT')
    if (!record) return null
    const data = (record.data ?? {}) as Record<string, unknown>
    const text = (value: unknown) => (typeof value === 'string' ? value : null)
    const count = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : null)
    return {
      code: formatVerificationCode(code),
      title: text(data.title),
      generatedAt: text(data.generatedAt) ?? record.at,
      pageCount: count(data.pageCount),
      rowCount: count(data.rowCount),
      pdfSha256: text(data.pdfSha256),
    }
  },
}
