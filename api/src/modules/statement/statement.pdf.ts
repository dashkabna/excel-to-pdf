import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import PDFDocument from 'pdfkit'
import qrcode from 'qrcode-generator'
import { AppError } from '../../lib/appError.js'
import { uploadedLogoPath } from './statement.logo.js'
import { formatVerificationCode } from './statement.verification.js'
import {
  verificationParagraphs,
  type StatementColumn,
  type StatementHeaderElement,
  type StatementHeaderLayout,
  type StatementPdfInput,
  type StatementSummaryRow,
} from './statement.schema.js'

/** pdfkit-д `openImage` бий ч @types/pdfkit-д тодорхойлогдоогүй. */
type Doc = PDFKit.PDFDocument & { openImage(src: string | Buffer): { width: number; height: number } }
type Align = StatementColumn['align']
type LaidColumn = { x: number; w: number; align: Align; label: string }

const FONT_FILES = { regular: 'Arimo-Regular.ttf', bold: 'Arimo-Bold.ttf' } as const
const F = { regular: 'statement-regular', bold: 'statement-bold' } as const

/*
 * Хэмжээсүүд нь жишиг хуулга (template.pdf)-аас pdftotext/pdftocairo-оор хэмжсэн pt утга:
 * хүснэгт x 20.16–565.91, мөр 6pt / 8.95pt алхамтай, 2+ хуудас шууд мөрөөр эхэлнэ.
 */
const MARGIN = { top: 9, bottom: 51, left: 20.16, right: 29.37 }
/** 2 дахь хуудаснаас эхлэн баганын нэр давтагдахгүй, мөрүүд дээд ирмэгээс эхэлнэ. */
const CONTINUATION_TOP = 2
/** Footer-ийн давхар зураас хүснэгтээс хоёр тийш ийм хэмжээгээр илүү гарна. */
const FOOTER_OVERHANG = 6
const FOOTER = { rule1: 25.73, text: 13.6, customGap: 3 } as const
const SIZE = { header: 6.75, logoLines: 5.63, title: 11.7, period: 6.75, th: 6, td: 6, footer: 5.25, wordmark: 22 } as const
/** Мөр хоорондын нэмэлт зай — фонтын мөрийн өндөр дээр нэмэгдэж жишигтэй ижил алхам өгнө. */
const GAP = { header: 2.74, logoLines: 1.78, table: 1.3 } as const
/**
 * Жишиг нь тод фонт ашиглалгүй энгийн фонтыг fill+stroke (Tr 2)-оор тодруулдаг —
 * үсгийн өргөн энгийнтэй ижил үлдэж байрлал таарна. Зураасны зузаан = хэмжээ × 0.04.
 */
const FAUX_BOLD_STROKE = 0.04
const PAD_X = 2.2
const PAD_Y = 0.375
const LOGO_BOX = { w: 124, h: 26 }
/** Логоны доорх мөрүүд зүүн талын толгойн талбаруудыг шахахгүйн тулд. */
const LOGO_LINES_MAX_W = 190
/** Гарчиг толгойн талбаруудын хажууд хуудасны төвд байрлах өндөр. */
const TITLE_TOP = 58.7
/** "Дуусах огноо" жишигт хүснэгтийн өргөний энэ хэсгээс зүүн тэгшлэгдэнэ. */
const PERIOD_MIDDLE_AT = 0.4065
const SPACING = {
  periodAfterHeader: 9.8,
  tableAfterPeriod: 1.9,
  labelsAfterRule: 8.3,
  ruleAfterLabels: 2.2,
  openingAfterHeader: 17.3,
  rowsAfterHeader: 6,
  rowsAfterOpening: 4.15,
  summaryBefore: 7.55,
  summaryBetween: 10.55,
  closingRuleAfter: 7,
} as const
const UB_TZ = 'Asia/Ulaanbaatar'
/**
 * Рендер синхрон бөгөөд `bufferPages` бүх хуудсыг footer зуртал санах ойд барина —
 * нарийн баганатай хүсэлт мөр бүрийг бүтэн хуудас болгож API-г гацааж болно.
 * Жирийн 10,000 мөрийн хуулга ~180 хуудас.
 */
export const MAX_PAGES = 500
const MAX_LINES = { headerField: 3, title: 2, tableHeader: 4 } as const

let assetsDirCache: string | null = null

/** src/ (tsx, vitest) болон dist/src/ (build)-ийн гүн өөр тул api/assets-ийг дээш хайж олно. */
const assetsDir = (): string => {
  if (assetsDirCache) return assetsDirCache
  let dir = dirname(fileURLToPath(import.meta.url))
  for (let depth = 0; depth < 8; depth++) {
    const candidate = join(dir, 'assets')
    if (existsSync(join(candidate, 'fonts', FONT_FILES.regular))) {
      assetsDirCache = candidate
      return candidate
    }
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  throw new Error('Тайлангийн фонт (api/assets/fonts) олдсонгүй')
}

/** "Хуулгын тайлан" хуудаснаас оруулсан байгууллагын лого (normalize хийсэн RGBA PNG). */
const findLogo = (): string | null => {
  const uploaded = uploadedLogoPath()
  return existsSync(uploaded) ? uploaded : null
}

/**
 * Тайлан бүрт логог нэг удаа уншина (RenderMeta.logo) — зурж байх үед өөр хэрэглэгч логог
 * сольсон ч урьдчилан харагдацтай тулгасан тэр л зураг PDF-д орно.
 */
const logoSources = new WeakMap<Doc, Buffer | string | null>()
const logoOf = (doc: Doc) => (logoSources.has(doc) ? logoSources.get(doc)! : findLogo())

/** Excel-ээс ирсэн \r, таб, удирдлагын тэмдэгт PDF-д хог дүрс болж харагддаг. */
const clean = (value: string) =>
  value
    .replace(/\r\n?|[\u0085\u2028\u2029]/g, '\n')
    .replace(/\t/g, ' ')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '')
    .trim()

export const formatStamp = (date: Date) => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: UB_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date)
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? ''
  return {
    date: `${get('year')}/${get('month')}/${get('day')}`,
    time: `${get('hour')}:${get('minute')}`,
    compact: `${get('year')}${get('month')}${get('day')}`,
  }
}

/** Нэвтрэлтгүй (одоогоор) тул хэрэглэгчийн нэр байхгүй бол footer-т нэргүйгээр бичнэ. */
export const provenanceText = (userName: string | null, sourceFileName: string, generatedAt: Date) => {
  const stamp = formatStamp(generatedAt)
  const file = sourceFileName ? `«${clean(sourceFileName)}» файлаас ` : ''
  const who = userName && clean(userName) ? `${clean(userName)} ` : ''
  return `Энэхүү тайланг TESO ITAM системд ${who}${file}${stamp.date} ${stamp.time}-д үүсгэв.`
}

const lineGaps = new WeakMap<Doc, number>()
const fauxBold = new WeakMap<Doc, number>()

/**
 * Фонт, хэмжээ, мөр хоорондын зайг хамт тохируулна — хэмжилт ба зурах хоёр ижил алхамтай байх ёстой.
 * `bold` үед drawText нь энгийн фонтыг fill+stroke-оор тодруулна.
 */
const useFont = (doc: Doc, font: string, size: number, gap = 0, bold = false) => {
  doc.font(font).fontSize(size).lineGap(gap)
  lineGaps.set(doc, gap)
  fauxBold.set(doc, bold ? size * FAUX_BOLD_STROKE : 0)
}

const lineHeight = (doc: Doc) => doc.currentLineHeight(true) + (lineGaps.get(doc) ?? 0)

const middleEllipsis = (chars: string[], keep: number) => {
  const head = Math.ceil(keep / 2)
  const tail = keep - head
  return `${chars.slice(0, head).join('')}…${tail > 0 ? chars.slice(-tail).join('') : ''}`
}

/** Урт файлын нэрийг дундуур нь богиносгож footer-ийн цаг заавал багтдаг болгоно. */
const fitProvenance = (doc: Doc, userName: string | null, sourceFileName: string, generatedAt: Date, maxW: number) => {
  const full = provenanceText(userName, sourceFileName, generatedAt)
  if (doc.widthOfString(full) <= maxW) return full
  const chars = Array.from(clean(sourceFileName))
  let best = provenanceText(userName, '', generatedAt)
  let lo = 0
  let hi = chars.length - 1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    const candidate = provenanceText(userName, middleEllipsis(chars, mid), generatedAt)
    if (doc.widthOfString(candidate) <= maxW) {
      best = candidate
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  return best
}

const paragraphHeight = (doc: Doc, paragraph: string, width: number) =>
  !paragraph || doc.widthOfString(paragraph) <= width ? lineHeight(doc) : doc.heightOfString(paragraph, { width })

/**
 * Мөр таслалт бүрийг тусад нь хэмжинэ: pdfkit нь зураасаар төгссөн үгийн
 * дараах "\n"-ийг тусдаа мөр болгож хоосон мөр үүсгэдэг ("…2980-\nVFS…").
 * Нэг мөрт багтах догол мөрийг heightOfString-гүйгээр хурдан хэмжинэ.
 */
const textHeight = (doc: Doc, text: string, width: number) => {
  if (!text) return lineHeight(doc)
  return text.split('\n').reduce((sum, paragraph) => sum + paragraphHeight(doc, paragraph, width), 0)
}

/**
 * `maxH`-д багтах хэмжээгээр догол мөр бүрийг зурна. `height` + `ellipsis` нь
 * хэтэрсэн текстийг тайрч, pdfkit-ийг автоматаар шинэ хуудас нэмэхээс сэргийлнэ.
 */
const drawText = (doc: Doc, text: string, x: number, y: number, width: number, maxH: number, align: Align) => {
  const lh = lineHeight(doc)
  let cursor = y
  for (const paragraph of text.split('\n')) {
    const remaining = y + maxH - cursor
    if (remaining < lh - 0.01) break
    const h = Math.min(paragraphHeight(doc, paragraph, width), remaining)
    if (paragraph) {
      const stroke = fauxBold.get(doc) ?? 0
      if (stroke > 0) doc.lineWidth(stroke).strokeColor('black')
      doc.text(paragraph, x, cursor, { width, height: h + 0.5, align, ellipsis: true, fill: true, stroke: stroke > 0 })
    }
    cursor += h
  }
}

/** Нүдийг босоо тэнхлэгт голлуулж зурна. */
const drawCell = (doc: Doc, text: string, x: number, y: number, w: number, rowH: number, align: Align) => {
  if (!text) return
  const innerW = Math.max(1, w - PAD_X * 2)
  const innerH = rowH - PAD_Y * 2
  const h = Math.min(textHeight(doc, text, innerW), innerH)
  drawText(doc, text, x + PAD_X, y + PAD_Y + (innerH - h) / 2, innerW, h, align)
}

const layoutColumns = (columns: StatementColumn[], left: number, contentW: number): LaidColumn[] => {
  const total = columns.reduce((sum, c) => sum + c.width, 0)
  let x = left
  return columns.map((c) => {
    const w = (c.width / total) * contentW
    const laid = { x, w, align: c.align, label: clean(c.label) }
    x += w
    return laid
  })
}

/**
 * Лого ба түүний доорх мэдээллийн мөрүүдийг нэг блок болгож баруун захад тулгана:
 * мөр байвал лого/мөр хоёул блокийн зүүн ирмэгээр, байхгүй бол лого баруун захаар.
 */
const drawLogoBlock = (doc: Doc, lines: string[], right: number, y: number) => {
  const logo = logoOf(doc)
  let logoW: number
  let logoH: number
  if (logo) {
    const image = doc.openImage(logo)
    const scale = Math.min(LOGO_BOX.w / image.width, LOGO_BOX.h / image.height)
    logoW = image.width * scale
    logoH = image.height * scale
  } else {
    useFont(doc, F.bold, SIZE.wordmark)
    logoW = doc.widthOfString('TESO')
    logoH = doc.currentLineHeight()
  }

  useFont(doc, F.regular, SIZE.logoLines, GAP.logoLines)
  const visible = lines.map(clean).filter(Boolean)
  const linesW = Math.min(LOGO_LINES_MAX_W, Math.max(0, ...visible.map((line) => doc.widthOfString(line))))
  // Мөр байвал жишигтэй адил блок нь логоны хайрцгийн өргөнтэй (мөрүүд x≈442-оос эхэлнэ).
  const width = Math.max(logoW, linesW, visible.length > 0 ? LOGO_BOX.w : 0)
  const x = right - width

  if (logo) {
    doc.image(logo, x, y, { width: logoW, height: logoH })
  } else {
    // Албан ёсны лого файл байршуулаагүй үед нэрийн бичиглэл харуулна.
    useFont(doc, F.bold, SIZE.wordmark)
    doc.fillColor('#0b2e59').text('TESO', x, y, { width: logoW + 1, lineBreak: false })
    doc.fillColor('black')
  }
  if (visible.length === 0) return { x, width, bottom: y + LOGO_BOX.h }

  useFont(doc, F.regular, SIZE.logoLines, GAP.logoLines)
  const lh = lineHeight(doc)
  let cursor = y + logoH + 3.3
  for (const line of visible) {
    drawText(doc, line, x, cursor, width, lh, 'left')
    cursor += lh
  }
  return { x, width, bottom: Math.max(cursor, y + LOGO_BOX.h) }
}

type Box = { y0: number; y1: number; x1: number }

const withColon = (label: string) => (label && !label.endsWith(':') ? `${label}:` : label)

const WORDMARK_COLOR = '#0b2e59'
/** Логоны хайрцгийн өндөр = үсгийн хэмжээ × энэ харьцаа (22pt → 26pt, автомат толгойн LOGO_BOX-той ижил). */
export const LOGO_HEIGHT_RATIO = LOGO_BOX.h / SIZE.wordmark

/**
 * Дизайнерын элементийн мөр хоорондын нэмэлт зай, үсгийн хэмжээний харьцаагаар —
 * анхдагч байрлал автомат толгойтой ижил алхамтай гарна. Вэб урьдчилан харагдац ижил утга ашиглана.
 */
export const DESIGN_GAP_RATIO: Record<StatementHeaderElement['kind'], number> = {
  field: GAP.header / SIZE.header,
  logoLines: GAP.logoLines / SIZE.logoLines,
  text: 0.3,
  title: 0,
  logo: 0,
  periodStart: 0,
  periodEnd: 0,
  printedDate: 0,
}
const DESIGN_MAX_LINES = { field: MAX_LINES.headerField, title: MAX_LINES.title, text: 4 } as const

/**
 * `room`-д үсэг нь (lineGap-гүй өндөр) багтах мөрийн тоо × мөрийн өндөр. Мөрийн доорх
 * lineGap хоосон зай тул сүүлийн мөр хүснэгтийн шугамд тулсан ч зурагдана —
 * урьдчилан харагдац элементийг шугамд тулгаж байрлуулдаг.
 */
const fittingHeight = (doc: Doc, room: number, maxLines: number) => {
  const lh = lineHeight(doc)
  const glyph = doc.currentLineHeight(false)
  if (room < glyph - 0.01) return 0
  return Math.min(maxLines, Math.floor((room - glyph) / lh + 1e-6) + 1) * lh
}

/** Хайрцагт багтах мөрөөр (`maxH`) ороож зурна, хэтэрвэл сүүлийн мөр "…"-ээр төгсөнө. */
const drawBoxText = (doc: Doc, text: string, x: number, y: number, w: number, maxH: number, align: Align) => {
  if (!text || maxH <= 0) return
  const h = Math.min(textHeight(doc, text, w), maxH)
  drawText(doc, text, x, y, w, Math.max(h, lineHeight(doc)), align)
}

/** Нэг мөрт тэмдэгтээр тайрч "…" залгана — урьдчилан харагдацын text-overflow: ellipsis-тэй ижил. */
const fitOneLine = (doc: Doc, text: string, w: number) => {
  if (doc.widthOfString(text) <= w) return text
  const chars = Array.from(text)
  let lo = 0
  let hi = chars.length - 1
  let best = '…'
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    const candidate = `${chars.slice(0, mid).join('').trimEnd()}…`
    if (doc.widthOfString(candidate) <= w) {
      best = candidate
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  return best
}

const drawOneLine = (doc: Doc, text: string, x: number, y: number, w: number, room: number, align: Align) => {
  if (!text || fittingHeight(doc, room, 1) === 0) return
  const fitted = fitOneLine(doc, text, w)
  const stroke = fauxBold.get(doc) ?? 0
  if (stroke > 0) doc.lineWidth(stroke).strokeColor('black')
  doc.text(fitted, x, y, { width: w, align, lineBreak: false, fill: true, stroke: stroke > 0 })
}

/**
 * Хэрэглэгчийн чирж байрлуулсан толгой: элемент бүрийг заасан pt байрлалд зурна.
 * Хуудаснаас гарсан байрлалыг хумьж, `bandHeight`-ээс доош орох хэсгийг тайрна.
 */
const drawDesignedHeader = (doc: Doc, input: StatementPdfInput, layout: StatementHeaderLayout, printedDate: string) => {
  const pageW = doc.page.width
  const band = layout.bandHeight
  const periodStart = clean(input.periodStart)
  const periodEnd = clean(input.periodEnd)

  for (const element of layout.elements) {
    const x = Math.min(Math.max(0, element.x), pageW - 8)
    const w = Math.max(1, Math.min(element.w, pageW - x))
    const y = Math.min(Math.max(0, element.y), band)
    const room = band - y
    const setFont = () =>
      useFont(doc, F.regular, element.fontSize, element.fontSize * DESIGN_GAP_RATIO[element.kind], element.bold)

    switch (element.kind) {
      case 'logo': {
        const boxH = Math.min(element.fontSize * LOGO_HEIGHT_RATIO, room)
        if (boxH <= 0) break
        const logo = logoOf(doc)
        if (logo) {
          const image = doc.openImage(logo)
          const scale = Math.min(w / image.width, boxH / image.height)
          if (!(scale > 0)) break
          const iw = image.width * scale
          const ix = element.align === 'right' ? x + w - iw : element.align === 'center' ? x + (w - iw) / 2 : x
          doc.image(logo, ix, y, { width: iw, height: image.height * scale })
        } else {
          // Нэрийн бичиглэл хэзээ ч ороогдохгүй (урьдчилан харагдац nowrap) — хайрцгаас бага зэрэг хальж болно.
          useFont(doc, F.bold, element.fontSize)
          if (fittingHeight(doc, room, 1) === 0) break
          const tw = doc.widthOfString('TESO')
          const tx = element.align === 'right' ? x + w - tw : element.align === 'center' ? x + (w - tw) / 2 : x
          doc.fillColor(WORDMARK_COLOR).text('TESO', tx, y, { lineBreak: false })
          doc.fillColor('black')
        }
        break
      }
      case 'logoLines': {
        setFont()
        const lh = lineHeight(doc)
        let cursor = y
        for (const line of input.logoLines.map(clean).filter(Boolean)) {
          if (fittingHeight(doc, band - cursor, 1) === 0) break
          drawOneLine(doc, line, x, cursor, w, band - cursor, element.align)
          cursor += lh
        }
        break
      }
      case 'field': {
        const field = input.headerFields[element.fieldIndex]
        if (!field) break
        setFont()
        const label = withColon(clean(field.label))
        const value = clean(field.value)
        const maxH = fittingHeight(doc, room, DESIGN_MAX_LINES.field)
        if (element.labelWidth > 0) {
          const labelW = Math.min(element.labelWidth, w)
          drawBoxText(doc, label, x, y, labelW, maxH, 'left')
          drawBoxText(doc, value, x + labelW, y, Math.max(1, w - labelW), maxH, element.align)
        } else {
          drawBoxText(doc, [label, value].filter(Boolean).join(' '), x, y, w, maxH, element.align)
        }
        break
      }
      case 'title':
        setFont()
        drawBoxText(doc, clean(input.title), x, y, w, fittingHeight(doc, room, DESIGN_MAX_LINES.title), element.align)
        break
      case 'periodStart':
      case 'periodEnd':
      case 'printedDate': {
        const text =
          element.kind === 'printedDate'
            ? `Одоогийн огноо: ${printedDate}`
            : element.kind === 'periodStart'
              ? periodStart && `Эхлэх огноо: ${periodStart}`
              : periodEnd && `Дуусах огноо: ${periodEnd}`
        setFont()
        drawOneLine(doc, text, x, y, w, room, element.align)
        break
      }
      case 'text':
        setFont()
        drawBoxText(doc, clean(element.text), x, y, w, fittingHeight(doc, room, DESIGN_MAX_LINES.text), element.align)
        break
    }
  }
}

/** Толгойн талбаруудыг зурж, гарчиг давхцахаас сэргийлэхэд эзэлсэн хүрээг буцаана. */
const drawHeaderFields = (doc: Doc, fields: StatementPdfInput['headerFields'], x: number, y: number, maxW: number) => {
  const visible = fields
    .map((f) => ({ label: clean(f.label), value: clean(f.value) }))
    .filter((f) => f.label || f.value)
    .map((f) => ({ ...f, label: withColon(f.label) }))
  const boxes: Box[] = []
  if (visible.length === 0) return { bottom: y, boxes }

  useFont(doc, F.regular, SIZE.header, GAP.header)
  const labelW = Math.min(150, Math.max(...visible.map((f) => doc.widthOfString(f.label))) + 4)
  const valueW = Math.max(40, maxW - labelW)
  const maxH = lineHeight(doc) * MAX_LINES.headerField
  let cursor = y
  for (const field of visible) {
    const h = Math.min(Math.max(textHeight(doc, field.label, labelW), textHeight(doc, field.value, valueW)), maxH)
    if (field.label) drawText(doc, field.label, x, cursor, labelW, h, 'left')
    if (field.value) drawText(doc, field.value, x + labelW, cursor, valueW, h, 'left')
    const valueExtent = field.value.includes('\n') ? valueW : Math.min(doc.widthOfString(field.value), valueW)
    boxes.push({ y0: cursor, y1: cursor + h, x1: x + (field.value ? labelW + valueExtent : doc.widthOfString(field.label)) })
    cursor += h
  }
  return { bottom: cursor, boxes }
}

/** Хоёр 1pt зураас 1pt зайтай — жишигт баганын нэрийн дээр/доор ба footer-т. */
const doubleRule = (doc: Doc, x0: number, x1: number, top: number) => {
  doc.lineWidth(1)
  doc.moveTo(x0, top + 0.5).lineTo(x1, top + 0.5).stroke()
  doc.moveTo(x0, top + 2.5).lineTo(x1, top + 2.5).stroke()
}

const drawTableHeader = (doc: Doc, cols: LaidColumn[], tableTop: number) => {
  const left = cols[0]!.x
  const right = cols[cols.length - 1]!.x + cols[cols.length - 1]!.w
  doubleRule(doc, left, right, tableTop)
  useFont(doc, F.regular, SIZE.th, GAP.table, true)
  const labelsTop = tableTop + SPACING.labelsAfterRule
  const labelsH = Math.min(
    Math.max(...cols.map((c) => textHeight(doc, c.label, Math.max(1, c.w - PAD_X * 2)))),
    lineHeight(doc) * MAX_LINES.tableHeader,
  )
  for (const c of cols) drawCell(doc, c.label, c.x, labelsTop - PAD_Y, c.w, labelsH + PAD_Y * 2, 'center')
  const bottomRuleTop = labelsTop + labelsH + SPACING.ruleAfterLabels
  doubleRule(doc, left, right, bottomRuleTop)
  return bottomRuleTop + 3
}

const measureRow = (doc: Doc, cells: string[], cols: LaidColumn[], maxInnerH: number) => {
  let innerH = lineHeight(doc)
  cols.forEach((c, i) => {
    const text = cells[i] ?? ''
    if (text) innerH = Math.max(innerH, textHeight(doc, text, Math.max(1, c.w - PAD_X * 2)))
  })
  return Math.min(innerH, maxInnerH) + PAD_Y * 2
}

/** Хураангуй мөрийн нэр нь эхний утгатай багана хүртэлх зайг эзэлнэ ("Нийт дүн", "Эцсийн үлдэгдэл"). */
const summaryLayout = (row: StatementSummaryRow, cols: LaidColumn[]) => {
  const cells = cols.map((_, i) => clean(row.cells[i] ?? ''))
  const label = clean(row.label)
  const firstValue = cells.findIndex((c) => c !== '')
  const span = firstValue === -1 ? cols.length : firstValue
  const last = cols[cols.length - 1]!
  // Эхний баганад утга байвал нэрийг тусдаа мөрөнд гаргана — давхцахгүй.
  const ownLine = label !== '' && span === 0
  const labelW = ownLine ? last.x + last.w - cols[0]!.x : cols[span - 1] ? cols[span - 1]!.x + cols[span - 1]!.w - cols[0]!.x : 0
  return { cells, label, span, ownLine, labelW }
}

/** QR-ийн тойрон цагаан зай (модулиар) — уншигч хүрээгээ олоход хэрэгтэй. */
const QR_QUIET_MODULES = 2
const QR_CAPTION_GAP = 8
const VERIFICATION_GAP_RATIO = 0.3
/** Схемийн доод хязгаар — тайлбар (код, "албан ёсны баримт биш") хэзээ ч хуудаснаас гарахгүй. */
const QR_MIN_CAPTION_W = 60
/** Хэвлэгч ирмэгийн ~4мм-ийг тайрдаг — шинэ хуудсанд QR-ийг дээд ирмэгээс зайтай эхлүүлнэ. */
const QR_PAGE_TOP = 14

/**
 * QR + тайлбарыг баруун margin дотор багтаана: X-ийг хумьж, тайлбарын өргөнийг үлдсэн зайгаар
 * хязгаарлана. Вэбийн verificationGeometry ижил тооцоотой.
 */
export const verificationGeometry = (v: { x: number; size: number; w: number }, pageW: number) => {
  const rightEdge = pageW - MARGIN.right
  const qrX = Math.min(Math.max(0, v.x), Math.max(0, rightEdge - v.size - QR_CAPTION_GAP - QR_MIN_CAPTION_W))
  const captionX = qrX + v.size + QR_CAPTION_GAP
  const maxCaptionW = Math.max(QR_MIN_CAPTION_W, rightEdge - captionX)
  return { qrX, captionX, captionW: Math.min(Math.max(v.w, QR_MIN_CAPTION_W), maxCaptionW), maxCaptionW }
}

/** Тайлбар дахь энэ тэмдэглэгээ шалгах хаягаар солигдоно — вэбийнхтэй ижил. */
export const VERIFICATION_URL_TOKEN = '{хаяг}'

/** Хэрэглэгч тайлбар өгөөгүй үеийн текст — вэбийн defaultVerificationText-тэй үг үсгээрээ ижил. */
export const DEFAULT_VERIFICATION_TEXT = [
  `Энэхүү тайланг TESO ITAM системд үүсгэсэн. QR кодыг уншуулах эсвэл ${VERIFICATION_URL_TOKEN} хаягаар орж кодыг оруулан бүртгэлийг шалгана уу.`,
  'Шалгах хуудсанд PDF файлаа оруулбал үүсгэснээс хойш өөрчлөгдөөгүй эсэхийг тулгана.',
].join('\n')

/** Кодын мөр ба анхааруулгын хооронд хэвлэгдэх догол мөрүүд — `{хаяг}`-ийг шалгах хаягаар сольсон. */
export const verificationBody = (baseUrl: string, text: string = DEFAULT_VERIFICATION_TEXT) =>
  verificationParagraphs(text.split(VERIFICATION_URL_TOKEN).join(baseUrl))

/**
 * Засах боломжгүй сүүлийн мөр: тайлбарыг юу ч гэж бичсэн QR-ийн хажууд энэ тайлан
 * банк эсвэл өөр байгууллагын баримт биш гэдэг нь заавал үлдэнэ.
 */
export const VERIFICATION_DISCLAIMER =
  'Энэ нь TESO ITAM-ын дотоод тайлан бөгөөд банк болон бусад байгууллагаас гаргасан албан ёсны баримт биш.'

/**
 * QR-ийн хажуугийн тайлбар: кодын мөр (тогтмол), хэрэглэгчийн текст, анхааруулга (тогтмол).
 * Вэбийн урьдчилан харагдац (statement-header-layout.ts) ижил бүтэцтэй.
 */
export const verificationCaption = (code: string, baseUrl: string, text?: string) => [
  `Баталгаажуулах код: ${formatVerificationCode(code)}`,
  ...verificationBody(baseUrl, text),
  VERIFICATION_DISCLAIMER,
]

/** QR-ийг вектор дөрвөлжингөөр зурна — мөр бүрийн дараалсан хар модулийг нэг тэгш өнцөгт болгоно. */
const drawQr = (doc: Doc, text: string, x: number, y: number, size: number) => {
  const qr = qrcode(0, 'M')
  qr.addData(text)
  qr.make()
  const n = qr.getModuleCount()
  const cell = size / (n + QR_QUIET_MODULES * 2)
  const ox = x + QR_QUIET_MODULES * cell
  const oy = y + QR_QUIET_MODULES * cell
  doc.save()
  for (let r = 0; r < n; r++) {
    let c = 0
    while (c < n) {
      if (!qr.isDark(r, c)) {
        c++
        continue
      }
      const start = c
      while (c < n && qr.isDark(r, c)) c++
      // Хөрш мөрүүдийн хооронд anti-aliasing-ийн нарийн зураас гарахгүйн тулд бага зэрэг давхцуулна.
      doc.rect(ox + start * cell, oy + r * cell, (c - start) * cell, cell + 0.05)
    }
  }
  doc.fillColor('black').fill()
  doc.restore()
}

export type RenderMeta = {
  userName: string | null
  /** Өгвөл энэ логог зурна (null — логогүй); өгөөгүй бол дискнээс уншина. */
  logo?: Buffer | null
  generatedAt: Date
  /** Баталгаажуулах QR — `input.verification` өгсөн үед зурагдана. */
  verification?: { code: string; url: string; baseUrl: string }
}

export async function renderStatementPdf(
  input: StatementPdfInput,
  meta: RenderMeta,
): Promise<{ buffer: Buffer; pageCount: number; rowsPerPage: number[] }> {
  const dir = assetsDir()
  const provenance = provenanceText(meta.userName, input.sourceFileName, meta.generatedAt)
  const doc = new PDFDocument({
    size: 'A4',
    layout: input.orientation,
    margins: MARGIN,
    bufferPages: true,
    info: {
      Title: clean(input.title),
      Author: 'TESO ITAM',
      Creator: 'TESO ITAM',
      Producer: 'TESO ITAM',
      Subject: provenance,
      CreationDate: meta.generatedAt,
    },
  }) as Doc
  if (meta.logo !== undefined) logoSources.set(doc, meta.logo)

  const chunks: Buffer[] = []
  const finished = new Promise<Buffer>((resolve, reject) => {
    doc.on('data', (chunk: Buffer) => chunks.push(chunk))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)
  })

  doc.registerFont(F.regular, join(dir, 'fonts', FONT_FILES.regular))
  doc.registerFont(F.bold, join(dir, 'fonts', FONT_FILES.bold))

  const left = MARGIN.left
  const contentW = doc.page.width - MARGIN.left - MARGIN.right
  const right = left + contentW
  const bottomLimit = doc.page.height - MARGIN.bottom

  /** Хуудас бүрт зурсан мөр (өгөгдөл + хураангуй) — хоосон хуудас үүсээгүйг шалгахад. */
  const rowsPerPage: number[] = [0]

  const stamp = formatStamp(meta.generatedAt)
  let y: number = MARGIN.top
  if (input.headerLayout) {
    drawDesignedHeader(doc, input, input.headerLayout, stamp.date)
    y = input.headerLayout.bandHeight
  } else {
    // ── Толгой: талбарууд (зүүн), лого + мэдээлэл (баруун), гарчиг (төвд), огнооны мөр ──
    const logoBlock = drawLogoBlock(doc, input.logoLines, right, y)
    const fields = drawHeaderFields(doc, input.headerFields, left, y, logoBlock.x - left - 16)

    useFont(doc, F.regular, SIZE.title, 0, true)
    const title = clean(input.title)
    const titleLH = lineHeight(doc)
    const titleW = doc.widthOfString(title)
    const titleX = (doc.page.width - titleW) / 2
    // Жишигт гарчиг талбаруудын хажууд хуудасны төвд байна; урт утга/гарчигтай давхцвал толгойн доор шилжинэ.
    const besideFields =
      !title.includes('\n') &&
      titleX > left &&
      titleX + titleW + 6 < logoBlock.x &&
      !fields.boxes.some((b) => b.y0 < TITLE_TOP + titleLH && b.y1 > TITLE_TOP && b.x1 + 6 > titleX)
    let titleBottom: number
    if (besideFields) {
      drawText(doc, title, titleX, TITLE_TOP, titleW + 1, titleLH, 'left')
      titleBottom = TITLE_TOP + titleLH
    } else {
      const top = Math.max(fields.bottom, logoBlock.bottom) + 4
      const h = Math.min(textHeight(doc, title, contentW), titleLH * MAX_LINES.title)
      drawText(doc, title, left, top, contentW, h, 'center')
      titleBottom = top + h
    }
    y = Math.max(fields.bottom, logoBlock.bottom, titleBottom) + SPACING.periodAfterHeader

    useFont(doc, F.regular, SIZE.period, 0, true)
    const periodStart = clean(input.periodStart)
    const periodEnd = clean(input.periodEnd)
    const periodItems: Array<[string, Align]> = [
      [periodStart ? `Эхлэх огноо: ${periodStart}` : '', 'left'],
      [periodEnd ? `Дуусах огноо: ${periodEnd}` : '', 'center'],
      [`Одоогийн огноо: ${stamp.date}`, 'right'],
    ]
    // Гурвуулаа өөр өөрийн гуравны нэгт багтвал нэг мөрөнд, үгүй бол давхцахгүйн тулд тус бүр мөрөнд.
    const third = contentW / 3
    const visibleItems = periodItems.filter(([text]) => text)
    const fitsInline = visibleItems.every(([text]) => doc.widthOfString(text) <= third - 6)
    if (fitsInline) {
      const [startItem, endItem, currentItem] = periodItems
      if (startItem[0]) drawText(doc, startItem[0], left + PAD_X, y, third - PAD_X * 2, lineHeight(doc), 'left')
      if (endItem[0]) drawText(doc, endItem[0], left + contentW * PERIOD_MIDDLE_AT, y, third, lineHeight(doc), 'left')
      drawText(doc, currentItem[0], left + third * 2, y, third - PAD_X, lineHeight(doc), 'right')
      y += lineHeight(doc)
    } else {
      // Урт огноонууд зүүн талд тус бүр мөрөнд; одоогийн огноо эхний мөрийн баруун талд.
      const current = periodItems[2]![0]
      const currentW = doc.widthOfString(current)
      periodItems
        .slice(0, 2)
        .filter(([text]) => text)
        .forEach(([text], i) => {
          drawText(doc, text, left + PAD_X, y, i === 0 ? contentW - currentW - 12 : contentW, lineHeight(doc), 'left')
          if (i === 0) drawText(doc, current, left, y, contentW - PAD_X, lineHeight(doc), 'right')
          y += lineHeight(doc)
        })
    }
    y += SPACING.tableAfterPeriod
    // Толгойн хэсэг хязгаарлагдсан ч хэвтээ хуудсанд хүснэгтэд зай үлдээгүй бол шинэ хуудаснаас эхэлнэ.
    if (y + 60 > bottomLimit) {
      doc.addPage()
      rowsPerPage.push(0)
      y = CONTINUATION_TOP
    }
  }

  // ── Хүснэгт: баганын нэр зөвхөн 1-р хуудсанд ──
  const cols = layoutColumns(input.columns, left, contentW)
  y = drawTableHeader(doc, cols, y)
  y += input.beforeRows.length > 0 ? SPACING.openingAfterHeader : SPACING.rowsAfterHeader
  // Нэг нүд хуудаснаас өндөр болохгүй — дараагийн хуудасны бүх өндрөөр хязгаарлана.
  const maxInnerH = bottomLimit - CONTINUATION_TOP - PAD_Y * 2 - 2

  const addPage = () => {
    if (doc.bufferedPageRange().count >= MAX_PAGES) {
      throw new AppError(
        'REPORT_TOO_LONG',
        `Тайлан ${MAX_PAGES} хуудаснаас хэтэрч байна. Нарийн баганын өргөнийг нэмэх эсвэл мөрийн тоог багасгана уу.`,
        422,
      )
    }
    doc.addPage()
    rowsPerPage.push(0)
    y = CONTINUATION_TOP
  }

  const ensureSpace = (h: number) => {
    if (y + h > bottomLimit) addPage()
  }

  const drawSummaryRows = (rows: StatementSummaryRow[], gapBefore: number, gapBetween: number) => {
    if (rows.length === 0) return
    y += gapBefore
    useFont(doc, F.regular, SIZE.td, GAP.table, true)
    rows.forEach((row, index) => {
      if (index > 0) y += gapBetween
      const layout = summaryLayout(row, cols)
      const labelH = layout.label ? textHeight(doc, layout.label, Math.max(1, layout.labelW - PAD_X * 2)) : 0
      const valuesH = measureRow(doc, layout.cells, cols, maxInnerH)
      const labelRowH = layout.ownLine ? labelH + PAD_Y * 2 : 0
      const rowH = layout.ownLine ? valuesH : Math.max(valuesH, Math.min(labelH, maxInnerH) + PAD_Y * 2)
      ensureSpace(labelRowH + rowH)
      if (layout.ownLine) {
        drawCell(doc, layout.label, cols[0]!.x, y, layout.labelW, labelRowH, 'left')
        y += labelRowH
      } else if (layout.label && layout.span > 0) {
        drawCell(doc, layout.label, cols[0]!.x, y, layout.labelW, rowH, 'left')
      }
      cols.forEach((c, i) => {
        if (i >= layout.span) drawCell(doc, layout.cells[i] ?? '', c.x, y, c.w, rowH, c.align)
      })
      rowsPerPage[rowsPerPage.length - 1]!++
      y += rowH
    })
  }

  drawSummaryRows(input.beforeRows, 0, SPACING.rowsAfterOpening)
  if (input.beforeRows.length > 0) y += SPACING.rowsAfterOpening

  useFont(doc, F.regular, SIZE.td, GAP.table)
  for (const raw of input.rows) {
    const cells = cols.map((_, i) => clean(raw[i] ?? ''))
    const rowH = measureRow(doc, cells, cols, maxInnerH)
    ensureSpace(rowH)
    cols.forEach((c, i) => drawCell(doc, cells[i] ?? '', c.x, y, c.w, rowH, c.align))
    rowsPerPage[rowsPerPage.length - 1]!++
    y += rowH
  }

  let contentEnd = y
  if (input.afterRows.length > 0) {
    drawSummaryRows(input.afterRows, SPACING.summaryBefore, SPACING.summaryBetween)
    // Footer-ийн зураас bottomLimit-ээс доош зайтай тул энэ зураас үргэлж багтана — шинэ хуудас хэрэггүй.
    const ruleY = Math.min(y + SPACING.closingRuleAfter, doc.page.height - FOOTER.rule1 - 6)
    doc.lineWidth(1.5).moveTo(left, ruleY).lineTo(right, ruleY).stroke()
    contentEnd = ruleY + 0.75
  }

  // ── Баталгаажуулах QR: агуулгын төгсгөлөөс `gap` зайд; багтахгүй бол дараагийн хуудсанд ──
  if (input.verification && meta.verification) {
    const v = input.verification
    const { qrX, captionX, captionW: requestedW, maxCaptionW } = verificationGeometry(v, doc.page.width)
    const paragraphs = verificationCaption(meta.verification.code, meta.verification.baseUrl, v.text)
    // Тайлбар нэг хуудсанд заавал багтана: эхлээд өргөсгөж, дараа нь үсгийг жижигрүүлнэ.
    const pageRoom = bottomLimit - QR_PAGE_TOP
    let fontSize = v.fontSize
    let captionW = requestedW
    const measure = () => {
      useFont(doc, F.regular, fontSize, fontSize * VERIFICATION_GAP_RATIO)
      return paragraphs.map((p) => textHeight(doc, p, captionW))
    }
    const blockHeight = (hs: number[]) => Math.max(v.size, hs.reduce((sum, h) => sum + h, 0))
    let heights = measure()
    if (blockHeight(heights) > pageRoom) {
      captionW = maxCaptionW
      heights = measure()
    }
    while (blockHeight(heights) > pageRoom && fontSize > 4) {
      fontSize = Math.max(4, fontSize - 0.5)
      heights = measure()
    }
    // 4pt-д ч багтахгүй (маш өргөн тэмдэгт гэх мэт) бол хэрэглэгчийн текстийг бүтэн мөрөөр тайрна —
    // кодын мөр ба анхааруулга хэзээ ч хуудаснаас гарахгүй, footer-тэй давхцахгүй.
    if (blockHeight(heights) > pageRoom) {
      const lh = lineHeight(doc)
      const last = heights.length - 1
      let room = pageRoom - heights[0]! - heights[last]!
      heights = heights.map((h, i) => {
        if (i === 0 || i === last) return h
        const lines = Math.floor(Math.max(0, Math.min(h, room)) / lh + 1e-6)
        room -= lines * lh
        return lines * lh
      })
    }
    y = contentEnd + v.gap
    if (y + blockHeight(heights) > bottomLimit) {
      addPage()
      y = QR_PAGE_TOP
    }
    drawQr(doc, meta.verification.url, qrX, y, v.size)
    let cursor = y
    paragraphs.forEach((paragraph, i) => {
      useFont(doc, F.regular, fontSize, fontSize * VERIFICATION_GAP_RATIO, i === 0)
      drawText(doc, paragraph, captionX, cursor, captionW, heights[i]!, 'left')
      cursor += heights[i]!
    })
  }

  // ── Footer: нийт хуудас мэдэгдсэний дараа хуудас бүрт ──
  const range = doc.bufferedPageRange()
  const footerLeft = left - FOOTER_OVERHANG
  const footerRight = right + FOOTER_OVERHANG
  const pageLabelW = 70
  const footerW = footerRight - footerLeft - pageLabelW - 10
  useFont(doc, F.regular, SIZE.footer)
  const footerText = fitProvenance(doc, meta.userName, input.sourceFileName, meta.generatedAt, footerW)
  const customFooter = input.footerText ? fitOneLine(doc, input.footerText, footerRight - footerLeft) : ''
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i)
    // Доод margin-аас доош бичихэд pdfkit шинэ хуудас нэмдэг тул түр 0 болгоно.
    const savedBottom = doc.page.margins.bottom
    doc.page.margins.bottom = 0
    doubleRule(doc, footerLeft, footerRight, doc.page.height - FOOTER.rule1 - 0.5)
    useFont(doc, F.regular, SIZE.footer)
    if (customFooter) {
      // Хэрэглэгчийн мөр шугамын дээр; доорх "Энэхүү тайланг ... үүсгэв." мөр тогтмол хэвээр.
      doc.text(customFooter, footerLeft, doc.page.height - FOOTER.rule1 - FOOTER.customGap - lineHeight(doc), {
        width: footerRight - footerLeft,
        lineBreak: false,
      })
    }
    const textY = doc.page.height - FOOTER.text
    doc.text(footerText, footerLeft, textY, {
      width: footerW,
      height: lineHeight(doc) + 1,
      lineBreak: false,
      ellipsis: true,
    })
    doc.text(`Хуудас ${i - range.start + 1} - ${range.count}`, footerRight - pageLabelW, textY, {
      width: pageLabelW,
      align: 'right',
      lineBreak: false,
    })
    doc.page.margins.bottom = savedBottom
  }

  doc.end()
  const buffer = await finished
  return { buffer, pageCount: range.count, rowsPerPage }
}
