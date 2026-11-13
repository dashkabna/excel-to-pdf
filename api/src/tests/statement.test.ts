import PDFDocument from 'pdfkit'
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import { crc32 } from 'node:zlib'
import path from 'node:path'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp } from '../app.js'
import { env } from '../config/env.js'
import { auditFile, findAuditEntry, resetAuditIndex, writeAuditLog, type AuditEntry } from '../lib/audit.js'
import { PNG } from 'pngjs'
import {
  DEFAULT_VERIFICATION_TEXT,
  VERIFICATION_DISCLAIMER,
  provenanceText,
  renderStatementPdf,
  verificationCaption,
} from '../modules/statement/statement.pdf.js'
import { statementPdfSchema } from '../modules/statement/statement.schema.js'
import { contentDisposition } from '../modules/statement/statement.service.js'
import {
  VERIFICATION_CODE_PATTERN,
  createVerificationCode,
  formatVerificationCode,
  sha256Hex,
} from '../modules/statement/statement.verification.js'

const app = createApp()

/** audit.jsonl-ийн мөрүүд — өгөгдлийн сангийн оронд тайлан, логоны бүртгэл энд нэмэгдэнэ. */
const auditEntries = async (): Promise<AuditEntry[]> => {
  let text: string
  try {
    text = await readFile(auditFile(), 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
  return text
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as AuditEntry)
}
/** Эхний аудитын мөрийг ITAM-ын тестүүдийн хэлбэрээр ({ data: { ..., newData } }) буцаана. */
const firstAudit = async () => {
  const entry = (await auditEntries())[0]
  return { data: { ...entry, newData: entry?.data } }
}
/** Аудитын файлыг бичих боломжгүй болгоно (замд нь хавтас) — бүртгэл амжилтгүй болох тохиолдол. */
const breakAudit = async () => {
  await rm(auditFile(), { recursive: true, force: true })
  await mkdir(auditFile(), { recursive: true })
}

// Хөгжүүлэгчийн ./data-д лого байвал PDF тестүүд түүнийг зурна — бүх тест хоосон хавтастай эхэлнэ.
let devDataDir = ''
beforeAll(async () => {
  devDataDir = env.DATA_DIR
  env.DATA_DIR = await mkdtemp(path.join(os.tmpdir(), 'teso-statement-'))
})
afterAll(async () => {
  await rm(env.DATA_DIR, { recursive: true, force: true })
  env.DATA_DIR = devDataDir
})
// Тест бүр хоосон бүртгэлтэй эхэлнэ (файлыг устгасан тул санах ойн индексийг ч цэвэрлэнэ).
beforeEach(async () => {
  await rm(auditFile(), { recursive: true, force: true })
  resetAuditIndex()
})
const URL = '/api/v1/statement-report/pdf'

const columns = [
  { label: '№', align: 'center', width: 0.6 },
  { label: 'Гүйлгээний огноо', align: 'center', width: 1 },
  { label: 'Гүйлгээний утга', align: 'left', width: 3 },
  { label: 'Орлого', align: 'right', width: 1.3 },
  { label: 'Зарлага', align: 'right', width: 1.3 },
  { label: 'Үлдэгдэл', align: 'right', width: 1.3 },
]

const row = (i: number) => [
  String(i),
  '12/16/2025',
  i % 5 === 0 ? 'TRF=002204491693-438054XXXXXX2980-\nVFS.GLOBAL WEB>U' : 'Ухаалаг мэдээ үйлчилгээний хураамж',
  i % 2 ? '675,350.00' : '',
  i % 2 ? '' : '-50.00',
  '2,683,836.73',
]

const validBody = (rowCount = 5) => ({
  title: 'Дансны дэлгэрэнгүй хуулга',
  headerFields: [
    { label: 'Харилцагчийн нэр', value: 'Тест харилцагч' },
    { label: 'Дансны дугаар', value: '1234567890' },
  ],
  periodStart: '2025-11-07',
  periodEnd: '2026-11-07',
  columns,
  rows: Array.from({ length: rowCount }, (_, i) => row(i + 1)),
  beforeRows: [{ label: 'Эхний үлдэгдэл', cells: ['', '', '', '', '', '10,830.17'] }],
  afterRows: [
    { label: 'Нийт дүн', cells: ['', '', '', '194,367,198.36', '194,378,028.53', ''] },
    { label: 'Эцсийн үлдэгдэл', cells: ['', '', '', '', '', '0.00'] },
  ],
  sourceFileName: 'AccountStatement.xlsx',
})

/** supertest нь application/pdf-ийг default-аар задлахгүй тул Buffer болгон цуглуулна. */
const binary = (res: NodeJS.ReadableStream, cb: (err: Error | null, body: Buffer) => void) => {
  const chunks: Buffer[] = []
  res.on('data', (chunk: Buffer) => chunks.push(chunk))
  res.on('end', () => cb(null, Buffer.concat(chunks)))
}

const pageCountOf = (pdf: Buffer) => (pdf.toString('latin1').match(/\/Type \/Page\b/g) ?? []).length

describe('POST /api/v1/statement-report/pdf', () => {
  beforeEach(() => {
  })

  it('returns a PDF and records an audit log entry', async () => {
    const res = await request(app)
      .post(URL)
      .send(validBody())
      .buffer(true)
      .parse(binary)

    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toBe('application/pdf')
    expect(res.headers['content-disposition']).toContain('attachment;')
    expect(res.headers['content-disposition']).toContain("filename*=UTF-8''")
    expect(res.headers['cache-control']).toBe('no-store')
    const pdf = res.body as Buffer
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-')
    expect(pageCountOf(pdf)).toBe(1)
    expect(res.headers['x-page-count']).toBe('1')

    expect(await auditEntries()).toHaveLength(1)
    const audit = (await firstAudit()) as { data: Record<string, unknown> }
    expect(audit.data).toMatchObject({
      action: 'EXPORT',
      entityType: 'StatementReport',
      newData: {
        title: 'Дансны дэлгэрэнгүй хуулга',
        sourceFileName: 'AccountStatement.xlsx',
        rowCount: 5,
        columnCount: 6,
        pageCount: 1,
      },
    })
    expect(typeof audit.data.ip).toBe('string')
  })

  it('paginates long statements', async () => {
    const res = await request(app)
      .post(URL)
      .send(validBody(400))
      .buffer(true)
      .parse(binary)

    expect(res.status).toBe(200)
    const pages = pageCountOf(res.body as Buffer)
    expect(pages).toBeGreaterThan(3)
    expect(res.headers['x-page-count']).toBe(String(pages))
  })

  it('renders landscape with no rows and no optional sections', async () => {
    const res = await request(app)
      .post(URL)
      .send({ title: 'Хоосон тайлан', orientation: 'landscape', columns: [{ label: 'A' }], rows: [] })
      .buffer(true)
      .parse(binary)

    expect(res.status).toBe(200)
    expect(pageCountOf(res.body as Buffer)).toBe(1)
  })

  it('handles a cell taller than a page by truncating instead of overflowing', async () => {
    const body = validBody(1)
    body.columns = [{ label: 'Нарийн', align: 'left', width: 0.3 }, { label: 'Өргөн', align: 'left', width: 20 }]
    body.rows = [['Ө'.repeat(500), 'x']]
    body.beforeRows = []
    body.afterRows = []
    const res = await request(app)
      .post(URL)
      .send(body)
      .buffer(true)
      .parse(binary)

    expect(res.status).toBe(200)
    // Мөр 1-р хуудасны толгойн доор багтахгүй тул 2-р хуудсанд шилжиж тайрагдана;
    // pdfkit өөрөө нэмэлт хуудас нэмсэн бол 3+ болно.
    expect(pageCountOf(res.body as Buffer)).toBe(2)
    expect(res.headers['x-page-count']).toBe('2')
  })

  it('rejects reports that would exceed the page cap without writing an audit row', async () => {
    const res = await request(app)
      .post(URL)
      .send({
        title: 'Нарийн багана',
        columns: [{ label: 'A', width: 0.3 }, { label: 'B', width: 20 }],
        rows: Array.from({ length: 600 }, () => ['x'.repeat(90), 'y']),
      })
    expect(res.status).toBe(422)
    expect(res.body.error.code).toBe('REPORT_TOO_LONG')
    expect(await auditEntries()).toHaveLength(0)
  })

  it('accepts info lines under the logo and rejects too many of them', async () => {
    const ok = await request(app)
      .post(URL)
      .send({ ...validBody(), logoLines: ['ТЕСО ГРУПП ХХК', 'Улаанбаатар хот', 'Утас: 7000-0000'] })
      .buffer(true)
      .parse(binary)
    expect(ok.status).toBe(200)

    const tooMany = await request(app)
      .post(URL)
      .send({ ...validBody(), logoLines: Array.from({ length: 7 }, (_, i) => `Мөр ${i + 1}`) })
    expect(tooMany.status).toBe(422)
    expect(tooMany.body.error.message).toContain('Логоны доорх мөр 6-аас хэтэрсэн')
  })



  it('rejects rows wider than the column definition', async () => {
    const body = validBody()
    body.rows[2] = [...body.rows[2]!, 'extra']
    const res = await request(app).post(URL).send(body)
    expect(res.status).toBe(422)
    expect(res.body.error.message).toContain('3-р мөр')
  })

  it('rejects a missing title and empty column list', async () => {
    const res = await request(app)
      .post(URL)
      .send({ ...validBody(), title: '  ', columns: [] })
    expect(res.status).toBe(422)
    expect(res.body.error.message).toContain('Тайлангийн гарчиг оруулна уу')
    expect(res.body.error.message).toContain('Дор хаяж нэг багана сонгоно уу')
  })

  it('rejects oversized cells', async () => {
    const body = validBody(1)
    body.rows = [['1', '2', 'x'.repeat(501), '', '', '']]
    const res = await request(app).post(URL).send(body)
    expect(res.status).toBe(422)
  })

  it('does not return the PDF when the audit log cannot be written', async () => {
    await breakAudit()
    const res = await request(app).post(URL).send(validBody())
    expect(res.status).toBe(500)
    expect(res.headers['content-type']).toContain('application/json')
  })
})

describe('statement report pagination', () => {
  // Хаалтын зураас ensureSpace-ээр шалгагддаг байхад хуудасны хил дээр зөвхөн толгойтой хоосон хуудас гардаг байв.
  it('never produces a page without table rows near page boundaries', async () => {
    // Эхний 2 нь хуучин кодоор яг хил дээр хоосон хуудас үүсгэж байсан тохиолдлууд (template.pdf-ийн
    // хэмжээстэй загвар). Загварын хэмжээс өөрчлөгдвөл scratch probe-оор дахин олж шинэчилнэ.
    const cases: Array<[multiLineEvery: number, count: number]> = [
      [2, 47],
      [5, 58],
      ...Array.from({ length: 31 }, (_, i): [number, number] => [3, 30 + i]),
    ]
    for (const [every, count] of cases) {
      const body = validBody(count)
      body.rows = Array.from({ length: count }, (_, i) => {
        const r = row(i + 1)
        r[2] = (i + 1) % every === 0 ? 'TRF=002204491693-438054XXXXXX2980-\nVFS.GLOBAL WEB>U' : 'Ухаалаг мэдээ үйлчилгээний хураамж'
        r[3] = (i + 1) % 2 ? '675,350.00' : ''
        r[4] = (i + 1) % 2 ? '' : '-50.00'
        return r
      })
      const input = statementPdfSchema.parse({ body }).body
      const { pageCount, rowsPerPage } = await renderStatementPdf(input, { userName: 'Тест', generatedAt: new Date() })
      expect(rowsPerPage).toHaveLength(pageCount)
      expect(rowsPerPage.every((n) => n > 0), `every=${every} count=${count}: ${rowsPerPage.join(',')}`).toBe(true)
    }
  })
})

const designedLayout = (bandHeight = 92) => ({
  bandHeight,
  elements: [
    { kind: 'logo', x: 440, y: 9, w: 124, fontSize: 22, bold: true, align: 'left' },
    { kind: 'logoLines', x: 440, y: 37, w: 124, fontSize: 5.63, align: 'left' },
    { kind: 'title', x: 180, y: 58.7, w: 235, fontSize: 11.7, bold: true, align: 'center' },
    { kind: 'field', fieldIndex: 0, labelWidth: 62, x: 20.16, y: 9, w: 300, fontSize: 6.75, align: 'left' },
    { kind: 'field', fieldIndex: 1, labelWidth: 0, x: 20.16, y: 19.5, w: 300, fontSize: 6.75, align: 'left' },
    { kind: 'periodStart', x: 22.36, y: 82, w: 177, fontSize: 6.75, bold: true, align: 'left' },
    { kind: 'periodEnd', x: 242, y: 82, w: 180, fontSize: 6.75, bold: true, align: 'left' },
    { kind: 'printedDate', x: 384, y: 82, w: 180, fontSize: 6.75, bold: true, align: 'right' },
    { kind: 'text', text: 'Дотоод хэрэгцээнд', x: 20.16, y: 60, w: 120, fontSize: 8, align: 'left' },
  ],
})

describe('designed header layout', () => {
  beforeEach(() => {
  })

  it('renders a dragged header layout', async () => {
    const res = await request(app)
      .post(URL)
      .send({ ...validBody(), logoLines: ['УЛААНБААТАР ХОТ', 'CENTRAL TOWER'], headerLayout: designedLayout() })
      .buffer(true)
      .parse(binary)
    expect(res.status).toBe(200)
    expect(pageCountOf(res.body as Buffer)).toBe(1)
  })

  it('starts the table at the band height, so a taller header pushes rows onto more pages', async () => {
    const render = async (bandHeight: number) => {
      const input = statementPdfSchema.parse({ body: { ...validBody(160), headerLayout: designedLayout(bandHeight) } }).body
      return renderStatementPdf(input, { userName: 'Тест', generatedAt: new Date() })
    }
    const short = await render(92)
    const tall = await render(400)
    expect(tall.rowsPerPage[0]).toBeLessThan(short.rowsPerPage[0]!)
    expect(tall.rowsPerPage.every((n) => n > 0)).toBe(true)
  })

  /** Рендерийн үеийн бүх `text()` дуудлагыг (текст, y) цуглуулна — PDF-ийн фонт subset тул байтаас хайж болохгүй. */
  const renderTexts = async (body: unknown) => {
    const spy = vi.spyOn(PDFDocument.prototype, 'text')
    try {
      const input = statementPdfSchema.parse({ body }).body
      const result = await renderStatementPdf(input, { userName: 'Тест', generatedAt: new Date() })
      const texts = spy.mock.calls.map(([text, x, y]) => ({ text: String(text), x: Number(x), y: Number(y) }))
      return { ...result, texts }
    } finally {
      spy.mockRestore()
    }
  }

  it('clips elements placed below the band instead of drawing them over the table', async () => {
    // Огнооны мөр (y=82) ба гарчиг (y=58.7) 60pt толгойноос доор — PDF-д огт гарах ёсгүй.
    const { pageCount, texts } = await renderTexts({ ...validBody(3), headerLayout: designedLayout(60) })
    expect(pageCount).toBe(1)
    expect(texts.some((t) => t.text.includes('Эхлэх огноо'))).toBe(false)
    expect(texts.some((t) => t.text.includes('Дансны дэлгэрэнгүй хуулга'))).toBe(false)
    expect(texts.some((t) => t.text.includes('Харилцагчийн нэр'))).toBe(true)
  })

  it('still draws an element whose glyphs touch the table line', async () => {
    // 6.75pt Arimo: үсгийн өндөр 7.54pt, мөрийн өндөр 7.76pt — урьдчилан харагдац шугамд тулгадаг.
    const glyph = (6.75 * (1854 + 434)) / 2048
    const { texts } = await renderTexts({ ...validBody(3), headerLayout: designedLayout(82 + glyph + 0.05) })
    expect(texts.filter((t) => /^(Эхлэх|Дуусах|Одоогийн) огноо/.test(t.text))).toHaveLength(3)
  })

  it('keeps the wordmark on one line even when its box is a hair narrower than the text', async () => {
    const layout = designedLayout()
    const logo = layout.elements.find((e) => e.kind === 'logo')!
    logo.fontSize = 20
    logo.w = 54.45 // 'TESO' Arimo Bold 20pt = 54.453pt
    const { texts } = await renderTexts({ ...validBody(1), headerLayout: layout })
    const wordmark = texts.filter((t) => t.text.startsWith('TES'))
    expect(wordmark.map((t) => t.text)).toEqual(['TESO'])
  })

  it('rejects a field element that points past the header fields', async () => {
    const layout = designedLayout()
    layout.elements.push({ kind: 'field', fieldIndex: 5, labelWidth: 0, x: 20, y: 30, w: 100, fontSize: 6.75, align: 'left' })
    const res = await request(app).post(URL).send({ ...validBody(), headerLayout: layout })
    expect(res.status).toBe(422)
    expect(res.body.error.message).toContain('6-р талбарыг заасан боловч 2 талбар байна')
  })

  it('rejects duplicated fixed elements, too many text boxes and an out-of-range band', async () => {
    const duplicated = designedLayout()
    duplicated.elements.push({ kind: 'title', x: 0, y: 0, w: 100, fontSize: 10, bold: false, align: 'left' })
    const texts = designedLayout()
    texts.elements.push(
      ...Array.from({ length: 12 }, (_, i) => ({ kind: 'text', text: `T${i}`, x: 0, y: 0, w: 50, fontSize: 6, align: 'left' })),
    )
    const cases: Array<[unknown, string]> = [
      [duplicated, '"title" элемент давхардсан'],
      [texts, 'Толгойн чөлөөт текст 12-аас хэтэрсэн'],
      [designedLayout(20), 'Толгойн хэсгийн өндөр 30–420pt'],
    ]
    for (const [headerLayout, message] of cases) {
      const res = await request(app).post(URL).send({ ...validBody(), headerLayout })
      expect(res.status).toBe(422)
      expect(res.body.error.message).toContain(message)
    }
    expect(await auditEntries()).toHaveLength(0)
  })
})

describe('statement report helpers', () => {
  it('stamps provenance in Ulaanbaatar time with the user and file name', () => {
    const text = provenanceText('Бат', 'хуулга.xlsx', new Date('2026-11-08T17:30:00Z'))
    expect(text).toBe('Энэхүү тайланг TESO ITAM системд Бат «хуулга.xlsx» файлаас 2026/11/09 01:30-д үүсгэв.')
  })

  it('omits the file clause when no source file name is given', () => {
    expect(provenanceText('Бат', '', new Date('2026-01-02T03:04:00Z'))).toBe(
      'Энэхүү тайланг TESO ITAM системд Бат 2026/01/02 11:04-д үүсгэв.',
    )
  })

  it('does not split an emoji at the 80 character cut', () => {
    const header = contentDisposition(`${'Ш'.repeat(79)}📊 тайлан`, new Date('2026-11-08T17:30:00Z'))
    const encoded = header.split("filename*=UTF-8''")[1]!
    expect(decodeURIComponent(encoded)).toBe(`${'Ш'.repeat(79)}📊-20261109.pdf`)
  })

  it('builds an ASCII fallback and a UTF-8 file name without path characters', () => {
    const header = contentDisposition('Хуулга / 2026: "Q4"', new Date('2026-11-08T17:30:00Z'))
    expect(header).toContain('filename="statement-20261109.pdf"')
    const encoded = header.split("filename*=UTF-8''")[1]!
    expect(decodeURIComponent(encoded)).toBe('Хуулга 2026 Q4-20261109.pdf')
  })
})

const verificationBlock = { x: 20.16, gap: 12, size: 64, w: 400, fontSize: 6 }

describe('verification QR', () => {
  beforeEach(() => {
  })

  /** QR-ийн модулиуд `rect`-ээр, тайлбар `text`-ээр зурагдана — PDF-ийн фонт subset тул байтаас хайж болохгүй. */
  const renderCalls = async (body: unknown, code = 'ABCDEFGHJKMNPQRS') => {
    const rect = vi.spyOn(PDFDocument.prototype, 'rect')
    const text = vi.spyOn(PDFDocument.prototype, 'text')
    try {
      const input = statementPdfSchema.parse({ body }).body
      const result = await renderStatementPdf(input, {
        userName: 'Тест',
        generatedAt: new Date(),
        verification: { code, url: `https://itd.teso.mn/verify/${code}`, baseUrl: 'https://itd.teso.mn/verify' },
      })
      return {
        ...result,
        rects: rect.mock.calls.length,
        rectBoxes: rect.mock.calls.map(([x, y]) => ({ x: Number(x), y: Number(y) })),
        texts: text.mock.calls.map(([t]) => String(t)),
        placed: text.mock.calls.map(([t, x, y, opts]) => ({
          text: String(t),
          x: Number(x),
          y: Number(y),
          width: Number((opts as { width?: number } | undefined)?.width ?? 0),
        })),
      }
    } finally {
      rect.mockRestore()
      text.mockRestore()
    }
  }

  it('records the printed code and the PDF hash in the audit row and returns the code', async () => {
    const res = await request(app)
      .post(URL)
      .send({ ...validBody(), verification: verificationBlock })
      .buffer(true)
      .parse(binary)
    expect(res.status).toBe(200)
    const audit = (await firstAudit()) as { data: { entityId: string; newData: Record<string, unknown> } }
    expect(audit.data.entityId).toMatch(VERIFICATION_CODE_PATTERN)
    expect(res.headers['x-verification-code']).toBe(audit.data.entityId)
    expect(audit.data.newData.pdfSha256).toBe(sha256Hex(res.body as Buffer))
    expect(audit.data.newData.hasVerificationQr).toBe(true)
  })

  it('draws the QR and its fixed caption only when the block is requested', async () => {
    const withQr = await renderCalls({ ...validBody(), verification: verificationBlock })
    expect(withQr.rects).toBeGreaterThan(40)
    expect(withQr.texts).toContain('Баталгаажуулах код: ABCD-EFGH-JKMN-PQRS')
    expect(withQr.texts.some((t) => t.includes('албан ёсны баримт биш'))).toBe(true)

    const without = await renderCalls(validBody())
    expect(without.rects).toBe(0)
    expect(without.texts.some((t) => t.startsWith('Баталгаажуулах код'))).toBe(false)
  })

  it('moves the block to a new page when it does not fit after the last row', async () => {
    // Хуудас бүрт хэдэн мөр багтахыг энгийн рендерээс олж, 2-р хуудсыг (хураангуйтай нь) бараг дүүргэнэ.
    const probe = await renderCalls(validBody(400))
    const count = probe.rowsPerPage[0]! + probe.rowsPerPage[1]! - 6
    const plain = await renderCalls(validBody(count))
    const pushed = await renderCalls({ ...validBody(count), verification: { ...verificationBlock, gap: 120 } })
    expect(pushed.pageCount).toBe(plain.pageCount + 1)
    expect(pushed.rowsPerPage.at(-1)).toBe(0)
    expect(pushed.texts).toContain('Баталгаажуулах код: ABCD-EFGH-JKMN-PQRS')
    // Шинэ хуудсанд хэвлэгчийн тайрдаг ирмэгээс зайтай эхэлнэ.
    expect(Math.min(...pushed.rectBoxes.map((r) => r.y))).toBeGreaterThanOrEqual(14)
  })

  it('keeps the caption on the page when the block is pushed to the right edge with the largest QR', async () => {
    const pageW = 595.28
    const { placed } = await renderCalls({ ...validBody(), verification: { ...verificationBlock, x: 463.28, size: 200, w: 473.75 } })
    const caption = placed.filter((t) => t.text.startsWith('Баталгаажуулах код') || t.text.includes('албан ёсны баримт биш'))
    expect(caption).toHaveLength(2)
    for (const t of caption) expect(t.x + t.width).toBeLessThanOrEqual(pageW - 29.37 + 0.01)
  })

  it('never lets a narrow caption at a large font run into the footer', async () => {
    const pageH = 841.89
    for (const orientation of ['portrait', 'landscape'] as const) {
      const bottomLimit = (orientation === 'portrait' ? pageH : 595.28) - 51
      const { placed } = await renderCalls({
        ...validBody(),
        orientation,
        verification: { ...verificationBlock, w: 60, fontSize: 14 },
      })
      const disclaimer = placed.find((t) => t.text.includes('албан ёсны баримт биш'))
      expect(disclaimer, orientation).toBeDefined()
      const paragraphs = verificationCaption('ABCDEFGHJKMNPQRS', 'https://itd.teso.mn/verify')
      const captionLines = placed.filter((t) => paragraphs.includes(t.text))
      expect(captionLines, orientation).toHaveLength(paragraphs.length)
      // Сүүлийн догол мөрийн эхлэл footer-ийн шугамаас дээр — бүтэн догол мөр хуудсанд багтана.
      expect(Math.max(...captionLines.map((t) => t.y)), orientation).toBeLessThan(bottomLimit)
    }
  })

  it('rejects an out-of-range block', async () => {
    const res = await request(app)
      .post(URL)
      .send({ ...validBody(), verification: { ...verificationBlock, size: 10 } })
    expect(res.status).toBe(422)
    expect(res.body.error.message).toContain('QR-ийн хэмжээ 40–200pt')
  })
})

describe('GET /api/v1/public/statement-reports/:code', () => {
  const VERIFY = '/api/v1/public/statement-reports'
  const register = (code: string) =>
    writeAuditLog({
      action: 'EXPORT',
      entityType: 'StatementReport',
      entityId: code,
      data: {
        title: 'Дансны дэлгэрэнгүй хуулга',
        sourceFileName: 'Хувийн нэр.xlsx',
        rowCount: 1127,
        columnCount: 11,
        pageCount: 22,
        generatedAt: '2026-11-09T03:00:00.000Z',
        pdfSha256: 'a'.repeat(64),
      },
      ip: '10.0.0.7',
    })

  it('answers without login and never exposes the source file or IP', async () => {
    await register('ABCDEFGHJKMNPQRS')
    const res = await request(app).get(`${VERIFY}/abcd-efgh-jkmn-pqrs`)
    expect(res.status).toBe(200)
    expect(res.body.data).toEqual({
      code: 'ABCD-EFGH-JKMN-PQRS',
      title: 'Дансны дэлгэрэнгүй хуулга',
      generatedAt: '2026-11-09T03:00:00.000Z',
      pageCount: 22,
      rowCount: 1127,
      pdfSha256: 'a'.repeat(64),
    })
    expect(JSON.stringify(res.body)).not.toContain('Хувийн нэр')
    expect(JSON.stringify(res.body)).not.toContain('10.0.0.7')
  })

  it('maps the commonly confused letters O, I and L when looking a code up', async () => {
    await register('0000111111112345')
    const res = await request(app).get(`${VERIFY}/OOOO-IIII-LLLL-2345`)
    expect(res.status).toBe(200)
    expect(res.body.data.code).toBe('0000-1111-1111-2345')
  })

  it('returns 404 for an unknown code and 422 for a malformed one, and skips a broken log line', async () => {
    await register('ABCDEFGHJKMNPQRS')
    await (await import('node:fs/promises')).appendFile(auditFile(), '{"truncated\n')
    const missing = await request(app).get(`${VERIFY}/ZZZZZZZZZZZZZZZZ`)
    expect(missing.status).toBe(404)
    expect(missing.body.error.message).toBe('Энэ кодтой тайлан бүртгэгдээгүй байна')
    expect((await request(app).get(`${VERIFY}/ABCDEFGHJKMNPQRS`)).status).toBe(200)

    const malformed = await request(app).get(`${VERIFY}/not-a-code`)
    expect(malformed.status).toBe(422)
  })
})

describe('verification codes', () => {
  it('are 16 unambiguous characters and do not repeat', () => {
    const codes = Array.from({ length: 2000 }, createVerificationCode)
    expect(codes.every((c) => VERIFICATION_CODE_PATTERN.test(c))).toBe(true)
    expect(new Set(codes).size).toBe(codes.length)
    expect(formatVerificationCode('ABCDEFGHJKMNPQRS')).toBe('ABCD-EFGH-JKMN-PQRS')
  })
})

describe('verification URL', () => {
  it('always points QR codes at https://itd.teso.mn — no env override, so the web preview (same constant) never differs', async () => {
    const saved = process.env.PUBLIC_WEB_URL
    try {
      process.env.PUBLIC_WEB_URL = 'https://verify.teso.mn/'
      vi.resetModules()
      const fresh = await import('../config/env.js')
      expect(fresh.publicWebUrl()).toBe('https://itd.teso.mn')
    } finally {
      if (saved === undefined) delete process.env.PUBLIC_WEB_URL
      else process.env.PUBLIC_WEB_URL = saved
      vi.resetModules()
    }
  })
})

describe('statement report logo', () => {
  const LOGO = '/api/v1/statement-report/logo'
  /** 1×1 RGBA PNG. */
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
  let originalDir = ''

  beforeAll(async () => {
    originalDir = env.DATA_DIR
    env.DATA_DIR = await mkdtemp(path.join(os.tmpdir(), 'itam-logo-'))
  })
  afterAll(async () => {
    await rm(env.DATA_DIR, { recursive: true, force: true })
    env.DATA_DIR = originalDir
  })
  beforeEach(async () => {
    await rm(path.join(env.DATA_DIR, 'logo.png'), { force: true })
  })

  it('stores an uploaded PNG, serves it back, uses it in the PDF and audits the change', async () => {
    const put = await request(app).put(LOGO).attach('file', png, 'logo.png')
    expect(put.status).toBe(200)
    expect(put.body.data).toMatchObject({ width: 1, height: 1 })
    const audit = (await firstAudit()) as { data: Record<string, unknown> }
    expect(audit.data).toMatchObject({ action: 'UPDATE', entityType: 'StatementLogo' })

    const get = await request(app).get(LOGO).buffer(true).parse(binary)
    expect(get.status).toBe(200)
    expect(get.headers['content-type']).toBe('image/png')
    // Хадгалсан нь дахин кодлогдсон RGBA PNG — серверийн хариулсан хэштэй таарна.
    expect(sha256Hex(get.body as Buffer)).toBe(put.body.data.sha256)

    const image = vi.spyOn(PDFDocument.prototype, 'image')
    try {
      const input = statementPdfSchema.parse({ body: validBody(1) }).body
      await renderStatementPdf(input, { userName: 'Тест', generatedAt: new Date() })
      expect(image).toHaveBeenCalledWith(path.join(env.DATA_DIR, 'logo.png'), expect.any(Number), expect.any(Number), expect.anything())
    } finally {
      image.mockRestore()
    }

    const del = await request(app).delete(LOGO)
    expect(del.status).toBe(200)
    expect((await request(app).get(LOGO)).status).toBe(404)
  })

  it('rejects files that are not PNG even when named .png, and corrupt PNG data', async () => {
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, ...Array(64).fill(0)])
    const notPng = await request(app).put(LOGO).attach('file', jpeg, 'logo.png')
    expect(notPng.status).toBe(422)
    expect(notPng.body.error.message).toBe('Зөвхөн PNG зураг оруулна уу')

    // Гарын үсэг, IHDR зөв, IDAT-ийн өгөгдөл эвдэрсэн.
    const corrupt = Buffer.from(png)
    corrupt.fill(0x41, 41, 47)
    const broken = await request(app).put(LOGO).attach('file', corrupt, 'logo.png')
    expect(broken.status).toBe(422)
    expect(broken.body.error.message).toContain('уншиж чадсангүй')
    expect(await auditEntries()).toHaveLength(0)
  })

  it('rejects a PNG whose data expands far beyond its declared size (decompression bomb)', async () => {
    // IHDR 1×1, IDAT нь 64MB тэг рүү задардаг — санах ой дүүргэхгүйгээр татгалзах ёстой.
    const { deflateSync } = await import('node:zlib')
    const chunk = (type: string, data: Buffer) => {
      const head = Buffer.alloc(8)
      head.writeUInt32BE(data.length, 0)
      head.write(type, 4, 'latin1')
      return Buffer.concat([head, data, Buffer.alloc(4)])
    }
    const ihdr = Buffer.from([0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0])
    const bomb = Buffer.concat([
      png.subarray(0, 8),
      chunk('IHDR', ihdr),
      chunk('IDAT', deflateSync(Buffer.alloc(64 * 1024 * 1024), { level: 9 })),
      chunk('IEND', Buffer.alloc(0)),
    ])
    expect(bomb.length).toBeLessThan(2 * 1024 * 1024)
    const res = await request(app).put(LOGO).attach('file', bomb, 'logo.png')
    expect(res.status).toBe(422)
  })

  /** Гараар PNG угсарна — pngjs палитр/tRNS бичихгүй тул. */
  const buildPng = (ihdr: Buffer, chunks: Array<[string, Buffer]>) => {
    // Жинхэнэ CRC — pngjs нь CRC буруу файлыг (зөвөөр) эвдэрсэн гэж үзнэ.
    const chunk = (type: string, data: Buffer) => {
      const head = Buffer.alloc(8)
      head.writeUInt32BE(data.length, 0)
      head.write(type, 4, 'latin1')
      const crc = Buffer.alloc(4)
      crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])))
      return Buffer.concat([head, data, crc])
    }
    return Buffer.concat([png.subarray(0, 8), chunk('IHDR', ihdr), ...chunks.map(([t, d]) => chunk(t, d)), chunk('IEND', Buffer.alloc(0))])
  }
  const ihdrOf = (w: number, h: number, depth: number, colorType: number) => {
    const b = Buffer.alloc(13)
    b.writeUInt32BE(w, 0)
    b.writeUInt32BE(h, 4)
    b[8] = depth
    b[9] = colorType
    return b
  }

  it('re-encodes a 4-bit palette PNG with transparency (as optimisers produce) to RGBA with the right pixels', async () => {
    const { deflateSync } = await import('node:zlib')
    const { PNG } = await import('pngjs')
    // 2×2: (0,0)=индекс 0 тунгалаг, (1,0)=индекс 1 улаан, мөр 2 нь эсрэгээрээ.
    const rows = Buffer.from([0, 0x01, 0, 0x10])
    const file = buildPng(ihdrOf(2, 2, 4, 3), [
      ['PLTE', Buffer.from([0, 0, 0, 255, 0, 0])],
      ['tRNS', Buffer.from([0])],
      ['IDAT', deflateSync(rows)],
    ])
    const put = await request(app).put(LOGO).attach('file', file, 'logo.png')
    expect(put.status).toBe(200)
    const storedBytes = await readFile(path.join(env.DATA_DIR, 'logo.png'))
    // pdfkit зөв зурдаг хэлбэр: 8 бит RGBA (color type 6), interlace-гүй.
    expect([storedBytes[24], storedBytes[25], storedBytes[28]]).toEqual([8, 6, 0])
    const stored = PNG.sync.read(storedBytes)
    expect(stored.width).toBe(2)
    expect([...stored.data]).toEqual([0, 0, 0, 0, 255, 0, 0, 255, 255, 0, 0, 255, 0, 0, 0, 0])
  })

  it('answers 422 instead of hanging on a PNG with an invalid scanline filter', async () => {
    const { deflateSync } = await import('node:zlib')
    const raw = Buffer.alloc(4 * (1 + 4 * 4))
    raw[0] = 9 // шүүлтүүр 0–4 байх ёстой
    const file = buildPng(ihdrOf(4, 4, 8, 6), [['IDAT', deflateSync(raw)]])
    const started = Date.now()
    const res = await request(app).put(LOGO).attach('file', file, 'logo.png')
    expect(res.status).toBe(422)
    expect(Date.now() - started).toBeLessThan(6000)
  })

  it('rejects a forged bit depth that would defeat the decompression limit', async () => {
    const { deflateSync } = await import('node:zlib')
    const file = buildPng(ihdrOf(64, 64, 255, 6), [['IDAT', deflateSync(Buffer.alloc(1024))]])
    const res = await request(app).put(LOGO).attach('file', file, 'logo.png')
    expect(res.status).toBe(422)
    expect(res.body.error.message).toBe('Зөвхөн PNG зураг оруулна уу')
  })

  it('keeps the previous logo when the audit row cannot be written, and does not audit deleting nothing', async () => {
    const first = await request(app).put(LOGO).attach('file', png, 'logo.png')
    expect(first.status).toBe(200)
    const before = await readFile(path.join(env.DATA_DIR, 'logo.png'))

    await breakAudit()
    const { deflateSync } = await import('node:zlib')
    const other = buildPng(ihdrOf(2, 1, 8, 2), [['IDAT', deflateSync(Buffer.from([0, 1, 2, 3, 4, 5, 6]))]])
    const failed = await request(app).put(LOGO).attach('file', other, 'logo.png')
    expect(failed.status).toBe(500)
    expect(Buffer.compare(await readFile(path.join(env.DATA_DIR, 'logo.png')), before)).toBe(0)

    await rm(auditFile(), { recursive: true, force: true })
    expect((await request(app).delete(LOGO)).body.data).toEqual({ removed: true })
    await rm(auditFile(), { recursive: true, force: true })
    const again = await request(app).delete(LOGO)
    expect(again.body.data).toEqual({ removed: false })
    expect(await auditEntries()).toHaveLength(0)
  })

  it('rejects files over 2MB and a request without a file', async () => {
    const big = Buffer.concat([png, Buffer.alloc(2 * 1024 * 1024)])
    const tooBig = await request(app).put(LOGO).attach('file', big, 'logo.png')
    expect(tooBig.status).toBe(413)

    const noFile = await request(app).put(LOGO)
    expect(noFile.status).toBe(422)
  })
})

describe('editable verification caption', () => {
  beforeEach(() => {
  })

  const captionTexts = async (verification: Record<string, unknown>) => {
    const text = vi.spyOn(PDFDocument.prototype, 'text')
    try {
      const input = statementPdfSchema.parse({ body: { ...validBody(), verification } }).body
      await renderStatementPdf(input, {
        userName: 'Тест',
        generatedAt: new Date(),
        verification: { code: 'ABCDEFGHJKMNPQRS', url: 'https://itd.teso.mn/verify/ABCDEFGHJKMNPQRS', baseUrl: 'https://itd.teso.mn/verify' },
      })
      return text.mock.calls.map(([t]) => String(t))
    } finally {
      text.mockRestore()
    }
  }

  it('prints the custom text between the fixed code line and the fixed disclaimer, one paragraph per line', async () => {
    const texts = await captionTexts({ ...verificationBlock, text: '  Санхүүгийн албаны дотоод хуулга.\r\n\n\tАсуух зүйл: 7700-1234  ' })
    const start = texts.indexOf('Баталгаажуулах код: ABCD-EFGH-JKMN-PQRS')
    expect(start).toBeGreaterThanOrEqual(0)
    expect(texts.slice(start, start + 4)).toEqual([
      'Баталгаажуулах код: ABCD-EFGH-JKMN-PQRS',
      'Санхүүгийн албаны дотоод хуулга.',
      'Асуух зүйл: 7700-1234',
      VERIFICATION_DISCLAIMER,
    ])
    expect(texts.some((t) => t.includes('QR кодыг уншуулах'))).toBe(false)
  })

  it('keeps only the code line and the disclaimer when the text is cleared, and the default text when it is omitted', async () => {
    const cleared = await captionTexts({ ...verificationBlock, text: '' })
    const start = cleared.indexOf('Баталгаажуулах код: ABCD-EFGH-JKMN-PQRS')
    expect(cleared[start + 1]).toBe(VERIFICATION_DISCLAIMER)

    const omitted = await captionTexts(verificationBlock)
    expect(omitted).toEqual(
      expect.arrayContaining(DEFAULT_VERIFICATION_TEXT.replace('{хаяг}', 'https://itd.teso.mn/verify').split('\n')),
    )
    expect(verificationCaption('ABCDEFGHJKMNPQRS', 'https://itd.teso.mn/verify')).toEqual([
      'Баталгаажуулах код: ABCD-EFGH-JKMN-PQRS',
      'Энэхүү тайланг TESO ITAM системд үүсгэсэн. QR кодыг уншуулах эсвэл https://itd.teso.mn/verify хаягаар орж кодыг оруулан бүртгэлийг шалгана уу.',
      'Шалгах хуудсанд PDF файлаа оруулбал үүсгэснээс хойш өөрчлөгдөөгүй эсэхийг тулгана.',
      'Энэ нь TESO ITAM-ын дотоод тайлан бөгөөд банк болон бусад байгууллагаас гаргасан албан ёсны баримт биш.',
    ])
  })

  it('records the printed caption text in the audit row', async () => {
    const res = await request(app)
      .post(URL)
      .send({ ...validBody(), verification: { ...verificationBlock, text: 'Дотоод хэрэгцээнд' } })
      .buffer(true)
      .parse(binary)
    expect(res.status).toBe(200)
    const audit = (await firstAudit()) as { data: { newData: Record<string, unknown> } }
    expect(audit.data.newData.verificationText).toBe('Дотоод хэрэгцээнд')
  })

  it('rejects text over 600 characters or 8 non-empty lines (blank lines do not count)', async () => {
    const send = (text: string) =>
      request(app)
        .post(URL)
        .send({ ...validBody(), verification: { ...verificationBlock, text } })
    const long = await send('а'.repeat(601))
    expect(long.status).toBe(422)
    expect(long.body.error.message).toContain('600 тэмдэгтээс')

    const lines = Array.from({ length: 9 }, (_, i) => `Мөр ${i + 1}`)
    const nine = await send(lines.join('\n'))
    expect(nine.status).toBe(422)
    expect(nine.body.error.message).toContain('8 мөрөөс')

    const eightWithBlanks = await send(lines.slice(0, 8).join('\n\n'))
    expect(eightWithBlanks.status).toBe(200)
  })
})

describe('resizable logo', () => {
  let originalDir = ''

  beforeAll(async () => {
    originalDir = env.DATA_DIR
    env.DATA_DIR = await mkdtemp(path.join(os.tmpdir(), 'itam-logo-size-'))
  })
  afterAll(async () => {
    await rm(env.DATA_DIR, { recursive: true, force: true })
    env.DATA_DIR = originalDir
  })
  beforeEach(() => {
  })

  const layoutWith = (logo: Record<string, unknown>, extra: Array<Record<string, unknown>> = []) => ({
    bandHeight: 200,
    elements: [{ kind: 'logo', x: 40, y: 9, w: 500, fontSize: 100, bold: true, align: 'left', ...logo }, ...extra],
  })

  it('accepts logo sizes up to 120 while text elements stay capped at 32pt', async () => {
    const send = (headerLayout: unknown) =>
      request(app).post(URL).send({ ...validBody(), headerLayout })
    expect((await send(layoutWith({ fontSize: 120 }))).status).toBe(200)

    const tooBig = await send(layoutWith({ fontSize: 121 }))
    expect(tooBig.status).toBe(422)
    expect(tooBig.body.error.message).toContain('Логоны хэмжээ 4–120')

    const bigTitle = await send(layoutWith({}, [{ kind: 'title', x: 20, y: 150, w: 300, fontSize: 33, align: 'left' }]))
    expect(bigTitle.status).toBe(422)
    expect(bigTitle.body.error.message).toContain('Үсгийн хэмжээ 4–32pt')
  })

  it('draws an uploaded logo at the enlarged size, fitted to the box with its aspect kept', async () => {
    const put = await request(app)
      .put('/api/v1/statement-report/logo')
      .attach('file', PNG.sync.write(new PNG({ width: 400, height: 100 })), 'logo.png')
    expect(put.status).toBe(200)

    const image = vi.spyOn(PDFDocument.prototype, 'image')
    try {
      const input = statementPdfSchema.parse({ body: { ...validBody(1), headerLayout: layoutWith({}) } }).body
      await renderStatementPdf(input, { userName: 'Тест', generatedAt: new Date() })
      const [, x, y, opts] = image.mock.calls[0]!
      // Хайрцаг 500 × (100 × 26/22 = 118.18): 400×100 зураг өндрөөрөө багтана → 472.73 × 118.18.
      expect(Number(x)).toBeCloseTo(40, 2)
      expect(Number(y)).toBeCloseTo(9, 2)
      expect((opts as { width: number }).width).toBeCloseTo((100 * 26) / 22 * 4, 2)
      expect((opts as { height: number }).height).toBeCloseTo((100 * 26) / 22, 2)
    } finally {
      image.mockRestore()
    }
  })
})

describe('verification caption hardening', () => {
  beforeEach(() => {
  })

  const placedTexts = async (body: Record<string, unknown>, baseUrl = 'https://itd.teso.mn/verify') => {
    const text = vi.spyOn(PDFDocument.prototype, 'text')
    try {
      const input = statementPdfSchema.parse({ body }).body
      const result = await renderStatementPdf(input, {
        userName: 'Тест',
        generatedAt: new Date(),
        verification: { code: 'ABCDEFGHJKMNPQRS', url: `${baseUrl}/ABCDEFGHJKMNPQRS`, baseUrl },
      })
      return {
        ...result,
        placed: text.mock.calls.map(([t, x, y, opts]) => ({
          text: String(t),
          x: Number(x),
          y: Number(y),
          height: Number((opts as { height?: number } | undefined)?.height ?? 0),
        })),
      }
    } finally {
      text.mockRestore()
    }
  }

  it('keeps the code line and the disclaimer on the page even when 8 lines of very wide glyphs cannot fit at 4pt', async () => {
    const wide = Array.from({ length: 8 }, () => '\u2E3B'.repeat(74)).join('\n')
    const { placed, pageCount } = await placedTexts({
      ...validBody(),
      orientation: 'landscape',
      verification: { x: 842, gap: 12, size: 40, w: 60, fontSize: 14, text: wide },
    })
    const bottomLimit = 595.28 - 51
    const code = placed.find((t) => t.text === 'Баталгаажуулах код: ABCD-EFGH-JKMN-PQRS')!
    const disclaimer = placed.find((t) => t.text === VERIFICATION_DISCLAIMER)!
    expect(code).toBeDefined()
    expect(disclaimer).toBeDefined()
    expect(disclaimer.y).toBeGreaterThan(code.y)
    expect(disclaimer.y + disclaimer.height).toBeLessThanOrEqual(bottomLimit + 0.6)
    // Хэрэглэгчийн текст тайрагдсан ч код, анхааруулга хоёулаа нэг хуудсанд.
    expect(placed.filter((t) => t.text.startsWith('\u2E3B')).length).toBeLessThan(8)
    expect(pageCount).toBeGreaterThanOrEqual(1)
  })

  it('replaces {хаяг} with the configured verification URL, in the PDF and in the audit row', async () => {
    const { placed } = await placedTexts({ ...validBody(), verification: verificationBlock }, 'https://verify.teso.mn/verify')
    expect(placed.some((t) => t.text.includes('https://verify.teso.mn/verify хаягаар'))).toBe(true)
    expect(placed.some((t) => t.text.includes('{хаяг}'))).toBe(false)

    const res = await request(app)
      .post(URL)
      .send({ ...validBody(), verification: { ...verificationBlock, text: 'Шалгах: {хаяг}' } })
    expect(res.status).toBe(200)
    const audit = (await firstAudit()) as { data: { newData: Record<string, unknown> } }
    expect(audit.data.newData.verificationText).toBe('Шалгах: https://itd.teso.mn/verify')
  })

  it('records the default text that was printed when the caption text is omitted', async () => {
    const res = await request(app).post(URL).send({ ...validBody(), verification: verificationBlock })
    expect(res.status).toBe(200)
    const audit = (await firstAudit()) as { data: { newData: Record<string, unknown> } }
    expect(audit.data.newData.verificationText).toBe(DEFAULT_VERIFICATION_TEXT.replace('{хаяг}', 'https://itd.teso.mn/verify'))
  })

  it('normalises the text before printing and auditing: NUL, lone surrogates, tabs and repeated spaces', async () => {
    const res = await request(app)
      .post(URL)
      .send({
        ...validBody(),
        title: 'Хуулга\u0000\uD800',
        sourceFileName: 'файл\u0000.xlsx',
        verification: { ...verificationBlock, text: '  Утас:\t\t7700   1234\u0000\uD800  \r\n\r\n Дотоод ' },
      })
    expect(res.status).toBe(200)
    const audit = (await firstAudit()) as { data: { newData: Record<string, unknown> } }
    expect(audit.data.newData.verificationText).toBe('Утас: 7700 1234\nДотоод')
    expect(audit.data.newData.title).toBe('Хуулга')
    expect(audit.data.newData.sourceFileName).toBe('файл.xlsx')
  })
})

describe('web preview line counting matches pdfkit', () => {
  it('counts the same wrapped lines as pdfkit for caption-like text at many widths and sizes', async () => {
    // Вэбийн урьдчилан харагдац тайлбарыг нэг хуудсанд багтаах шийдвэрээ энэ тоололд үндэслэдэг.
    const { pdfLineCount } = await import('../../../web/features/statement/lib/statement-header-layout.js')
    const doc = new PDFDocument({ size: 'A4' })
    doc.registerFont('arimo', path.resolve('assets/fonts/Arimo-Regular.ttf'))
    doc.font('arimo')
    const measure = (text: string, size: number) => doc.fontSize(size).widthOfString(text)
    const samples = [
      'Энэхүү тайланг TESO ITAM системд үүсгэсэн. QR кодыг уншуулах эсвэл https://itd.teso.mn/verify хаягаар орж кодыг оруулан бүртгэлийг шалгана уу.',
      'Шалгах хуудсанд PDF файлаа оруулбал үүсгэснээс хойш өөрчлөгдөөгүй эсэхийг тулгана.',
      'Энэ нь TESO ITAM-ын дотоод тайлан бөгөөд банк болон бусад байгууллагаас гаргасан албан ёсны баримт биш.',
      'Баталгаажуулах код: ABCD-EFGH-JKMN-PQRS',
      'TESO-ийн санхүүгийн албаны дотоод хуулга. Утас: 7700-1234, 1/2 a/b A—B A–B «үг» эсвэл? тийм!',
      'Урт_үг_зайгүй_' + 'Ш'.repeat(60),
      '\u2E3B'.repeat(30),
      'Санхүүгийн алба утас / факс / цахим шуудан / хаяг 1 бөгөөд Нягтлан / Ня-бо',
      'Утас : 7700-1234 , факс : 7700-1235 ; хаяг ( төв байр ) асуулт ? тийм !',
      'Шалгах хаяг: https://itd.teso.mn/verify?code=ABCD&lang=mn#top эсвэл verify!now',
      'Дүн 1\u00A0000\u00A0000₮, огноо 2026\u202F11\u202F13, «Ишлэл» -«үг» a--b (тест-)',
    ]
    const mismatches: string[] = []
    for (const text of samples) {
      for (const size of [4, 6, 9, 14]) {
        for (const width of [60, 90, 120.52, 200, 473.75]) {
          doc.fontSize(size)
          const expected =
            doc.widthOfString(text) <= width ? 1 : Math.round(doc.heightOfString(text, { width, lineGap: 0 }) / doc.currentLineHeight(true))
          const actual = pdfLineCount(text, width, size, measure)
          if (actual !== expected) mismatches.push(`${size}pt/${width}pt "${text.slice(0, 24)}…": web ${actual}, pdfkit ${expected}`)
        }
      }
    }
    expect(mismatches).toEqual([])
  })
})

describe('rate limits (no login, so requests are limited per IP)', () => {
  it('stops repeated logo changes from one address with 429', async () => {
    const saved = env.NODE_ENV
    env.NODE_ENV = 'production'
    try {
      const statuses: number[] = []
      for (let i = 0; i < 12; i++) statuses.push((await request(app).delete('/api/v1/statement-report/logo')).status)
      expect(statuses.slice(0, 10).every((s) => s === 200)).toBe(true)
      expect(statuses.at(-1)).toBe(429)
    } finally {
      env.NODE_ENV = saved
    }
  })
})

describe('port hardening (no login, no database)', () => {
  const LOGO = '/api/v1/statement-report/logo'
  const logoPng = (seed: number) => {
    const png = new PNG({ width: 4, height: 2 })
    png.data.fill(seed)
    return PNG.sync.write(png)
  }
  beforeEach(async () => {
    await rm(path.join(env.DATA_DIR, 'logo.png'), { force: true })
  })

  it('prints the footer without a user name, exactly as the web preview shows it', () => {
    const at = new Date('2026-11-08T17:30:00Z')
    expect(provenanceText(null, 'хуулга.xlsx', at)).toBe('Энэхүү тайланг TESO ITAM системд «хуулга.xlsx» файлаас 2026/11/09 01:30-д үүсгэв.')
    expect(provenanceText(null, '', at)).toBe('Энэхүү тайланг TESO ITAM системд 2026/11/09 01:30-д үүсгэв.')
  })

  it('verifies only EXPORT records of statement reports, never a logo or other entry with the same id', async () => {
    await writeAuditLog({ action: 'UPDATE', entityType: 'StatementReport', entityId: 'ABCDEFGHJKMNPQRS', data: { title: 'x' } })
    await writeAuditLog({ action: 'EXPORT', entityType: 'Other', entityId: 'ABCDEFGHJKMNPQRS', data: { title: 'x' } })
    expect((await request(app).get('/api/v1/public/statement-reports/ABCDEFGHJKMNPQRS')).status).toBe(404)
  })

  it('keeps a record findable after a truncated line without a trailing newline (disk full)', async () => {
    const { appendFile, mkdir } = await import('node:fs/promises')
    await mkdir(env.DATA_DIR, { recursive: true })
    await appendFile(auditFile(), '{"truncated":')
    await writeAuditLog({ action: 'EXPORT', entityType: 'StatementReport', entityId: 'AAAAAAAAAAAAAAAA', data: {} })
    resetAuditIndex()
    expect(await findAuditEntry('StatementReport', 'AAAAAAAAAAAAAAAA', 'EXPORT')).not.toBeNull()
  })

  it('finds records from the index without rereading the file, and picks up records written later', async () => {
    await writeAuditLog({ action: 'EXPORT', entityType: 'StatementReport', entityId: 'BBBBBBBBBBBBBBBB', data: {} })
    expect(await findAuditEntry('StatementReport', 'BBBBBBBBBBBBBBBB', 'EXPORT')).not.toBeNull()
    await writeAuditLog({ action: 'EXPORT', entityType: 'StatementReport', entityId: 'CCCCCCCCCCCCCCCC', data: {} })
    expect(await findAuditEntry('StatementReport', 'CCCCCCCCCCCCCCCC', 'EXPORT')).not.toBeNull()
  })

  it('refuses a PDF whose preview used a different logo than the current one (409), and accepts a matching one', async () => {
    const put = await request(app).put(LOGO).attach('file', logoPng(10), 'logo.png')
    expect(put.status).toBe(200)
    const get = await request(app).get(LOGO).buffer(true).parse(binary)
    expect(get.headers['x-logo-sha256']).toBe(put.body.data.sha256)

    const stale = await request(app).post(URL).send({ ...validBody(1), logoSha256: 'f'.repeat(64) })
    expect(stale.status).toBe(409)
    expect(stale.body.error.code).toBe('LOGO_CHANGED')
    const noLogoPreview = await request(app).post(URL).send({ ...validBody(1), logoSha256: null })
    expect(noLogoPreview.status).toBe(409)
    expect((await request(app).post(URL).send({ ...validBody(1), logoSha256: put.body.data.sha256 })).status).toBe(200)
    expect((await request(app).post(URL).send(validBody(1))).status).toBe(200)

    await request(app).delete(LOGO)
    expect((await request(app).post(URL).send({ ...validBody(1), logoSha256: null })).status).toBe(200)
    expect((await auditEntries()).filter((e) => e.entityType === 'StatementReport')).toHaveLength(3)
  })

  it('serialises concurrent logo uploads: every one succeeds, is audited, and the final logo is one of them', async () => {
    const uploads = Array.from({ length: 20 }, (_, i) => logoPng(i * 10))
    const results = await Promise.all(uploads.map((png) => request(app).put(LOGO).attach('file', png, 'logo.png')))
    expect(results.map((r) => r.status)).toEqual(Array(20).fill(200))
    const audited = (await auditEntries()).filter((e) => e.action === 'UPDATE').map((e) => (e.data as { sha256: string }).sha256)
    expect(audited).toHaveLength(20)
    expect(audited.at(-1)).toBe(sha256Hex(await readFile(path.join(env.DATA_DIR, 'logo.png'))))
  })

  it('rejects multipart text fields and extra parts on the logo upload instead of buffering them', async () => {
    const res = await request(app).put(LOGO).field('junk', 'x'.repeat(2048)).attach('file', logoPng(1), 'logo.png')
    expect(res.status).toBe(422)
  })

  it('answers client errors from the body parser and router with 4xx, not 500', async () => {
    const badPath = await request(app).get('/api/v1/public/statement-reports/%E0%A4%A')
    expect(badPath.status).toBe(400)
    const latin1 = await request(app).post(URL).set('Content-Type', 'application/json; charset=latin1').send('{}')
    expect(latin1.status).toBe(415)
    expect(latin1.body.error.code).toBe('UNSUPPORTED_MEDIA_TYPE')
  })
})
