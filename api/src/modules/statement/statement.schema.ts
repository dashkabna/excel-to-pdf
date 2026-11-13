import { z } from 'zod'

/**
 * Body нь JSON (`express.json` 2mb хязгаартай) тул мөрийн тоог үүнээс давахгүй
 * байхаар хязгаарлана — 11 баганатай 10,000 мөр ойролцоогоор 1.5MB.
 */
export const STATEMENT_LIMITS = {
  columns: 16,
  rows: 10_000,
  headerFields: 12,
  logoLines: 6,
  summaryRows: 6,
  headerElements: 40,
  headerTexts: 12,
  cellLength: 500,
  /** Логоны "хэмжээ" (үсгийн хэмжээтэй ижил нэгж): хайрцгийн өндөр = хэмжээ × 26/22 → 120 нь ~142pt. */
  logoSize: 120,
  /** QR-ийн хажуугийн засварлах текст — мөр бүр тусдаа догол мөр. */
  verificationTextChars: 600,
  verificationTextLines: 8,
} as const

/** Хосгүй UTF-16 surrogate ба NUL нь аудитын jsonb мөрийг бичихэд алдаа өгдөг (PostgreSQL хүлээн авдаггүй). */
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g
export const stripUnstorable = (value: string) => value.replace(LONE_SURROGATE, '').replace(/\u0000/g, '')

/**
 * QR-ийн тайлбарын догол мөрүүд: мөр бүр нэг догол мөр, хоосон мөр алгасна, дараалсан
 * зайг нэг болгоно (PDF ба урьдчилан харагдац ижил зурна). Схем, PDF, вэбийн урьдчилан
 * харагдац (statement-header-layout.ts) ижил хуваалт хэрэглэнэ.
 */
export const verificationParagraphs = (text: string) =>
  stripUnstorable(text)
    .replace(/\r\n?|[\u0085\u2028\u2029]/g, '\n')
    .replace(/\t/g, ' ')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '')
    .split('\n')
    .map((line) => line.replace(/ {2,}/g, ' ').trim())
    .filter(Boolean)

const cell = z.string().max(STATEMENT_LIMITS.cellLength, `Нүдний утга ${STATEMENT_LIMITS.cellLength} тэмдэгтээс хэтэрсэн`)

const columnSchema = z.object({
  label: z.string().trim().max(60, 'Баганын нэр 60 тэмдэгтээс хэтэрсэн'),
  align: z.enum(['left', 'center', 'right']).default('left'),
  /** Харьцангуй өргөн — бүх баганын нийлбэрт эзлэх хувиар хуудсанд хуваарилна. */
  width: z
    .number()
    .finite()
    .min(0.3, 'Баганын өргөн 0.3–20 хооронд байна')
    .max(20, 'Баганын өргөн 0.3–20 хооронд байна')
    .default(1),
})

const summaryRowSchema = z.object({
  label: z.string().trim().max(80, 'Хураангуй мөрийн нэр 80 тэмдэгтээс хэтэрсэн'),
  cells: z.array(cell).max(STATEMENT_LIMITS.columns, `Хураангуй мөрийн нүд ${STATEMENT_LIMITS.columns}-аас хэтэрсэн`),
})

const headerFieldSchema = z.object({
  label: z.string().trim().max(60, 'Толгойн талбарын нэр 60 тэмдэгтээс хэтэрсэн'),
  value: z.string().trim().max(200, 'Толгойн талбарын утга 200 тэмдэгтээс хэтэрсэн'),
})

const ALIGN = z.enum(['left', 'center', 'right'])

/** Нэг удаа л байх, агуулга нь тайлангийн бусад талбараас ирэх толгойн элементүүд. */
export const FIXED_HEADER_KINDS = ['title', 'logo', 'logoLines', 'periodStart', 'periodEnd', 'printedDate'] as const

/** Толгойн элементийн байрлал pt-ээр, хуудасны зүүн дээд булангаас (хэвтээ A4 хамгийн өргөн нь 842pt). */
const placement = {
  x: z.number().finite().min(0, 'Элементийн X 0–842pt').max(842, 'Элементийн X 0–842pt'),
  y: z.number().finite().min(0, 'Элементийн Y 0–420pt').max(420, 'Элементийн Y 0–420pt'),
  w: z.number().finite().min(8, 'Элементийн өргөн 8pt-аас багагүй').max(842),
  fontSize: z.number().finite().min(4, 'Үсгийн хэмжээ 4–32pt').max(32, 'Үсгийн хэмжээ 4–32pt'),
  bold: z.boolean().default(false),
  align: ALIGN.default('left'),
}

/** Текстэн тогтмол элементүүд — лого тусдаа (томоор байрлуулж болно). */
const TEXT_FIXED_KINDS = ['title', 'logoLines', 'periodStart', 'periodEnd', 'printedDate'] as const

const headerElementSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('field'),
    fieldIndex: z.number().int().min(0).max(STATEMENT_LIMITS.headerFields - 1),
    /** 0 бол нэр, утга нэг мөрөнд дараалж гарна. */
    labelWidth: z.number().finite().min(0, 'Нэрийн өргөн 0–842pt').max(842, 'Нэрийн өргөн 0–842pt').default(0),
    ...placement,
  }),
  z.object({ kind: z.enum(TEXT_FIXED_KINDS), ...placement }),
  z.object({
    kind: z.literal('logo'),
    ...placement,
    fontSize: z
      .number()
      .finite()
      .min(4, `Логоны хэмжээ 4–${STATEMENT_LIMITS.logoSize}`)
      .max(STATEMENT_LIMITS.logoSize, `Логоны хэмжээ 4–${STATEMENT_LIMITS.logoSize}`),
  }),
  z.object({ kind: z.literal('text'), text: z.string().trim().max(200, 'Толгойн текст 200 тэмдэгтээс хэтэрсэн'), ...placement }),
])

/**
 * Тайлангийн дизайнераар чирж байрлуулсан толгой. Өгөөгүй бол сервер толгойг
 * автоматаар байрлуулна. `bandHeight` — 1-р хуудсанд хүснэгт эхлэх өндөр.
 */
const headerLayoutSchema = z.object({
  bandHeight: z.number().finite().min(30, 'Толгойн хэсгийн өндөр 30–420pt').max(420, 'Толгойн хэсгийн өндөр 30–420pt'),
  elements: z
    .array(headerElementSchema)
    .max(STATEMENT_LIMITS.headerElements, `Толгойн элемент ${STATEMENT_LIMITS.headerElements}-аас хэтэрсэн`),
})

/**
 * Баталгаажуулах QR блок — агуулгын төгсгөлөөс `gap` pt доор, `x` нь хуудасны зүүн ирмэгээс.
 * Өгөөгүй бол QR зурагдахгүй. `text` нь кодын мөр ба "албан ёсны баримт биш" мөрийн хооронд
 * гарах тайлбар (өгөөгүй бол анхдагч тайлбар); энэ хоёр мөр тогтмол.
 */
const verificationSchema = z.object({
  x: z.number().finite().min(0, 'QR-ийн X 0–842pt').max(842, 'QR-ийн X 0–842pt'),
  gap: z.number().finite().min(0, 'QR-ийн зай 0–300pt').max(300, 'QR-ийн зай 0–300pt'),
  size: z.number().finite().min(40, 'QR-ийн хэмжээ 40–200pt').max(200, 'QR-ийн хэмжээ 40–200pt'),
  w: z.number().finite().min(60, 'QR-ийн тайлбарын өргөн 60–842pt').max(842, 'QR-ийн тайлбарын өргөн 60–842pt'),
  fontSize: z.number().finite().min(4, 'QR-ийн тайлбарын үсэг 4–14pt').max(14, 'QR-ийн тайлбарын үсэг 4–14pt'),
  // Хэвийн болгосон текст (PDF ба аудит яг нэг текстийг харна). `{хаяг}` нь шалгах хаягаар солигдоно.
  text: z
    .string()
    .max(STATEMENT_LIMITS.verificationTextChars, `QR-ийн тайлбар ${STATEMENT_LIMITS.verificationTextChars} тэмдэгтээс хэтэрсэн`)
    .transform((text) => verificationParagraphs(text))
    .refine(
      (paragraphs) => paragraphs.length <= STATEMENT_LIMITS.verificationTextLines,
      `QR-ийн тайлбар ${STATEMENT_LIMITS.verificationTextLines} мөрөөс хэтэрсэн`,
    )
    .transform((paragraphs) => paragraphs.join('\n'))
    .optional(),
})

const statementBody = z
  .object({
    title: z.string().transform(stripUnstorable).pipe(
      z.string().trim().min(1, 'Тайлангийн гарчиг оруулна уу').max(120, 'Гарчиг 120 тэмдэгтээс хэтэрсэн'),
    ),
    headerFields: z
      .array(headerFieldSchema)
      .max(STATEMENT_LIMITS.headerFields, `Толгойн талбар ${STATEMENT_LIMITS.headerFields}-аас хэтэрсэн`)
      .default([]),
    /** Логоны доор харагдах байгууллагын мэдээлэл (хаяг, утас, вэб) — мөр бүр тусдаа. */
    logoLines: z
      .array(z.string().trim().max(80, 'Логоны доорх мөр 80 тэмдэгтээс хэтэрсэн'))
      .max(STATEMENT_LIMITS.logoLines, `Логоны доорх мөр ${STATEMENT_LIMITS.logoLines}-аас хэтэрсэн`)
      .default([]),
    periodStart: z.string().trim().max(40, 'Эхлэх огноо 40 тэмдэгтээс хэтэрсэн').default(''),
    periodEnd: z.string().trim().max(40, 'Дуусах огноо 40 тэмдэгтээс хэтэрсэн').default(''),
    orientation: z.enum(['portrait', 'landscape']).default('portrait'),
    columns: z
      .array(columnSchema)
      .min(1, 'Дор хаяж нэг багана сонгоно уу')
      .max(STATEMENT_LIMITS.columns, `Баганын тоо ${STATEMENT_LIMITS.columns}-аас хэтэрсэн`),
    rows: z
      .array(z.array(cell).max(STATEMENT_LIMITS.columns, `Мөрийн нүд ${STATEMENT_LIMITS.columns}-аас хэтэрсэн`))
      .max(STATEMENT_LIMITS.rows, `Мөрийн тоо ${STATEMENT_LIMITS.rows.toLocaleString('en-US')}-аас хэтэрсэн`),
    beforeRows: z
      .array(summaryRowSchema)
      .max(STATEMENT_LIMITS.summaryRows, `Хураангуй мөр ${STATEMENT_LIMITS.summaryRows}-аас хэтэрсэн`)
      .default([]),
    afterRows: z
      .array(summaryRowSchema)
      .max(STATEMENT_LIMITS.summaryRows, `Хураангуй мөр ${STATEMENT_LIMITS.summaryRows}-аас хэтэрсэн`)
      .default([]),
    sourceFileName: z
      .string()
      .transform(stripUnstorable)
      .pipe(z.string().trim().max(200, 'Файлын нэр 200 тэмдэгтээс хэтэрсэн'))
      .default(''),
    headerLayout: headerLayoutSchema.optional(),
    verification: verificationSchema.optional(),
    /**
     * Урьдчилан харагдацад харуулсан логоны SHA-256 (null — логогүй). Нэвтрэлтгүй тул хэн ч
     * логог сольж болно — зөрвөл 409 буцааж хэрэглэгч шинэ логоор дахин харна.
     */
    logoSha256: z
      .string()
      .regex(/^[0-9a-f]{64}$/, 'Логоны хэш буруу байна')
      .nullable()
      .optional(),
  })
  .superRefine((body, ctx) => {
    const width = body.columns.length
    const check = (cells: string[], path: (string | number)[], label: string) => {
      if (cells.length > width) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path,
          message: `${label}: ${cells.length} нүдтэй боловч ${width} багана тодорхойлсон байна`,
        })
        return false
      }
      return true
    }
    // Эхний алдаагаар зогсоно — 10,000 мөр бүрт issue үүсгэвэл хариу хэт томорно.
    for (let i = 0; i < body.rows.length; i++) {
      if (!check(body.rows[i]!, ['rows', i], `${i + 1}-р мөр`)) break
    }
    body.beforeRows.forEach((row, i) => check(row.cells, ['beforeRows', i, 'cells'], row.label || 'Хураангуй мөр'))
    body.afterRows.forEach((row, i) => check(row.cells, ['afterRows', i, 'cells'], row.label || 'Хураангуй мөр'))

    const elements = body.headerLayout?.elements ?? []
    elements.forEach((element, i) => {
      if (element.kind === 'field' && element.fieldIndex >= body.headerFields.length) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['headerLayout', 'elements', i, 'fieldIndex'],
          message: `Толгойн элемент ${element.fieldIndex + 1}-р талбарыг заасан боловч ${body.headerFields.length} талбар байна`,
        })
      }
    })
    if (elements.filter((e) => e.kind === 'text').length > STATEMENT_LIMITS.headerTexts) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['headerLayout', 'elements'],
        message: `Толгойн чөлөөт текст ${STATEMENT_LIMITS.headerTexts}-аас хэтэрсэн`,
      })
    }
    for (const kind of FIXED_HEADER_KINDS) {
      if (elements.filter((e) => e.kind === kind).length > 1) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['headerLayout', 'elements'], message: `"${kind}" элемент давхардсан` })
      }
    }
  })

export const statementPdfSchema = z.object({
  body: statementBody,
  params: z.object({}).optional().default({}),
  query: z.object({}).optional().default({}),
})

export type StatementPdfInput = z.infer<typeof statementBody>
export type StatementColumn = StatementPdfInput['columns'][number]
export type StatementSummaryRow = StatementPdfInput['afterRows'][number]
export type StatementHeaderLayout = NonNullable<StatementPdfInput['headerLayout']>
export type StatementHeaderElement = StatementHeaderLayout['elements'][number]
