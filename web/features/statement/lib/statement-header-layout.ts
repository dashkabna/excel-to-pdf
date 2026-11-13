import type { ColumnAlign, Orientation } from './statement-xlsx'

/*
 * Толгойн дизайнерын координат нь PDF-ийн pt, хуудасны зүүн дээд булангаас.
 * Тогтмолууд API-ийн PDF модуль (pdf)-тэй ижил байх ёстой —
 * урьдчилан харагдац ба PDF хоёр нэг байрлалыг харуулна.
 */
export const PAGE: Record<Orientation, { w: number; h: number }> = {
  portrait: { w: 595.28, h: 841.89 },
  landscape: { w: 841.89, h: 595.28 },
}
const MARGIN = { top: 9, left: 20.16, right: 29.37 }
export const PAGE_MARGIN = MARGIN

/** Arimo/Arial: (ascent + descent + lineGap) / em ба lineGap-гүй хувилбар. */
export const LINE_HEIGHT_RATIO = (1854 + 434 + 67) / 2048
export const CONTENT_HEIGHT_RATIO = (1854 + 434) / 2048
/** Логоны хайрцгийн өндөр = үсгийн хэмжээ × энэ (22pt → 26pt). */
export const LOGO_HEIGHT_RATIO = 26 / 22

export const BAND_LIMITS = { min: 30, max: 420 } as const
export const FONT_LIMITS = { min: 4, max: 32 } as const
/** Логоны "хэмжээ" (хайрцгийн өндөр = хэмжээ × 26/22) — серверийн STATEMENT_LIMITS.logoSize-тэй ижил. */
export const LOGO_SIZE_LIMITS = { min: 4, max: 120 } as const
/** Серверийн toHeaderLayout/схемийн элементийн доод өргөн. */
const LOGO_MIN_W = 8
export const sizeLimits = (kind: HeaderKind) => (kind === 'logo' ? LOGO_SIZE_LIMITS : FONT_LIMITS)
export const HEADER_TEXT_LIMIT = 12

export const FIXED_KINDS = ['title', 'logo', 'logoLines', 'periodStart', 'periodEnd', 'printedDate'] as const
export type FixedKind = (typeof FIXED_KINDS)[number]
export type HeaderKind = FixedKind | 'field' | 'text'

const SIZE = { field: 6.75, logoLines: 5.63, title: 11.7, period: 6.75, wordmark: 22, text: 6.75 } as const

/** Мөр хоорондын нэмэлт зай / үсгийн хэмжээ — серверийн DESIGN_GAP_RATIO-той ижил. */
export const GAP_RATIO: Record<HeaderKind, number> = {
  field: 2.74 / 6.75,
  logoLines: 1.78 / 5.63,
  text: 0.3,
  title: 0,
  logo: 0,
  periodStart: 0,
  periodEnd: 0,
  printedDate: 0,
}
export const MAX_LINES: Partial<Record<HeaderKind, number>> = { field: 3, title: 2, text: 4 }

export type HeaderBox = { x: number; y: number; w: number; fontSize: number; bold: boolean; align: ColumnAlign }
export type FieldBox = HeaderBox & { labelWidth: number }
export type TextBox = HeaderBox & { id: string; text: string }

/**
 * Баталгаажуулах QR блок — хүснэгт/хураангуйн төгсгөлөөс `gap` pt доор, `x` нь хуудасны
 * зүүн ирмэгээс. `text` нь кодын мөр ба анхааруулгын (хоёулаа тогтмол) хооронд гарах тайлбар.
 */
export type VerificationBox = { x: number; gap: number; size: number; w: number; fontSize: number; text: string; hidden: boolean }
export type VerificationPayload = Omit<VerificationBox, 'hidden'>

export const VERIFICATION_LIMITS = {
  gap: { min: 0, max: 300 },
  size: { min: 40, max: 200 },
  w: { min: 60, max: 842 },
  fontSize: { min: 4, max: 14 },
  /** Серверийн STATEMENT_LIMITS.verificationTextChars / verificationTextLines. */
  textChars: 600,
  textLines: 8,
} as const
/** QR ба тайлбарын хоорондох зай, тайлбарын мөр хоорондын нэмэлт зай — серверийнхтэй ижил. */
export const VERIFICATION_CAPTION_GAP = 8
export const VERIFICATION_GAP_RATIO = 0.3
export const VERIFICATION_CODE_PLACEHOLDER = 'XXXX-XXXX-XXXX-XXXX'

/** QR-ийн хаяг — серверийн DEFAULT_PUBLIC_WEB_URL-тэй ижил (бүх орчинд production сайт). */
export const VERIFICATION_BASE_URL = 'https://itd.teso.mn/verify'

/**
 * Тайлбар дахь энэ тэмдэглэгээг сервер шалгах хаягаар (PUBLIC_WEB_URL-аас) солино — QR-ийн
 * хаягтай үргэлж ижил. Урьдчилан харагдац VERIFICATION_BASE_URL-аар солино.
 */
export const VERIFICATION_URL_TOKEN = '{хаяг}'

/** API-ийн PDF модуль (pdf)-ийн DEFAULT_VERIFICATION_TEXT-тэй үг үсгээрээ ижил. */
export const defaultVerificationText = () =>
  [
    `Энэхүү тайланг TESO ITAM системд үүсгэсэн. QR кодыг уншуулах эсвэл ${VERIFICATION_URL_TOKEN} хаягаар орж кодыг оруулан бүртгэлийг шалгана уу.`,
    'Шалгах хуудсанд PDF файлаа оруулбал үүсгэснээс хойш өөрчлөгдөөгүй эсэхийг тулгана.',
  ].join('\n')

/** Засах боломжгүй сүүлийн мөр — серверийн VERIFICATION_DISCLAIMER. */
export const VERIFICATION_DISCLAIMER =
  'Энэ нь TESO ITAM-ын дотоод тайлан бөгөөд банк болон бусад байгууллагаас гаргасан албан ёсны баримт биш.'

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g

/**
 * Серверийн verificationParagraphs-тэй ижил хуваалт: мөр бүр догол мөр, хоосон мөр алгасна,
 * дараалсан зайг нэг болгоно.
 */
export const verificationParagraphs = (text: string) =>
  text
    .replace(LONE_SURROGATE, '')
    .replace(/\r\n?|[\u0085\u2028\u2029]/g, '\n')
    .replace(/\t/g, ' ')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '')
    .split('\n')
    .map((line) => line.replace(/ {2,}/g, ' ').trim())
    .filter(Boolean)

/** Серверийн хязгаарт багтаана: эхний 8 догол мөр, 600 тэмдэгт — урьдчилан харагдац ба PDF ижил текст харуулна. */
export const clampVerificationText = (text: string) =>
  verificationParagraphs(text.slice(0, VERIFICATION_LIMITS.textChars)).slice(0, VERIFICATION_LIMITS.textLines).join('\n')

/** API-ийн PDF модуль (pdf)-ийн verificationCaption-тэй ижил бүтэц: код, тайлбар, анхааруулга. */
export const verificationCaption = (code: string, text: string) => [
  `Баталгаажуулах код: ${code}`,
  ...verificationParagraphs(clampVerificationText(text).split(VERIFICATION_URL_TOKEN).join(VERIFICATION_BASE_URL)),
  VERIFICATION_DISCLAIMER,
]

/**
 * pdfkit-ийн LineWrapper-тэй ижил аргаар мөр тоолно: үгийн араас орох зай нь багтах эсэхэд
 * тооцогдоно, мөрөөс урт үгийг үлдсэн зайд тэмдэгтээр тасална. Тасрах цэг нь pdfkit-ийн
 * `linebreak` (UAX-14)-тэй энгийн текстэд ижил: зайны дараа, "-" ба "/"-ийн дараа (цифрийн өмнө
 * биш), "–", "…"-ийн дараа, "—"-ийн өмнө ба дараа.
 */
export function pdfLineCount(text: string, lineWidth: number, fontSize: number, measure: Measure): number {
  if (!text) return 1
  const words: string[] = []
  let start = 0
  const chars = Array.from(text)
  const breakAfter = (i: number) => {
    const ch = chars[i]!
    const next = chars[i + 1]!
    if (OPENERS.includes(ch)) return false
    if (BREAK_SPACE.test(ch)) {
      if (BREAK_SPACE.test(next) || NO_BREAK_BEFORE.includes(next)) return false
      // "( текст" — нээх хаалтын араас зай байсан ч тасрахгүй.
      let j = i
      while (j >= 0 && BREAK_SPACE.test(chars[j]!)) j--
      return !(j >= 0 && OPENERS.includes(chars[j]!))
    }
    if (BREAK_SPACE.test(next) || NO_BREAK_BEFORE.includes(next) || QUOTES.includes(next) || next === '-') return false
    if (next === '\u2014') return ch !== '\u2014'
    if (ch === '-' || ch === '/') return !/\d/.test(next)
    return ch === '\u2013' || ch === '\u2014' || ch === '?' || ch === '!' || (ch === '\u2026' && next !== '\u2026')
  }
  for (let i = 0; i < chars.length - 1; i++) {
    if (breakAfter(i)) {
      words.push(chars.slice(start, i + 1).join(''))
      start = i + 1
    }
  }
  words.push(chars.slice(start).join(''))

  const width = (s: string) => measure(s, fontSize)
  let lines = 0
  let used = false
  let spaceLeft = lineWidth
  const place = (piece: string, w: number, required: boolean) => {
    const fits = w <= spaceLeft
    if (fits && piece) used = true
    if (required || !fits) {
      lines++
      if (required) {
        spaceLeft = lineWidth
        used = false
      } else {
        spaceLeft = lineWidth - w
        used = true
      }
    } else {
      spaceLeft -= w
    }
  }
  for (const word of words) {
    let w = width(word)
    if (w <= lineWidth) {
      place(word, w, false)
      continue
    }
    let rest = Array.from(word)
    while (rest.length) {
      let l: number
      let mightGrow = false
      if (w > spaceLeft) {
        l = Math.ceil(spaceLeft / (w / rest.length))
        w = width(rest.slice(0, l).join(''))
        mightGrow = w <= spaceLeft && l < rest.length
      } else {
        l = rest.length
      }
      let mustShrink = w > spaceLeft && l > 0
      while (mustShrink || mightGrow) {
        if (mustShrink) {
          w = width(rest.slice(0, --l).join(''))
          mustShrink = w > spaceLeft && l > 0
        } else {
          w = width(rest.slice(0, ++l).join(''))
          mustShrink = w > spaceLeft && l > 0
          mightGrow = w <= spaceLeft && l < rest.length
        }
      }
      if (l === 0 && spaceLeft === lineWidth) l = 1
      place(rest.slice(0, l).join(''), w, l < rest.length)
      rest = rest.slice(l)
      w = width(rest.join(''))
    }
  }
  return used ? lines + 1 : Math.max(lines, 1)
}

/** UAX-14: тасарч болох зай (NBSP, U+2007, U+202F тасрахгүй), OP, өмнө нь тасрахгүй CL/CP/IS/EX/SY, QU. */
const BREAK_SPACE = /[ \u1680\u2000-\u2006\u2008-\u200A\u205F\u3000]/
const OPENERS = '([{'
const NO_BREAK_BEFORE = ')]},.:;!?/'
const QUOTES = '"\'«»“”„'

/** Серверийн MARGIN.bottom (footer-ийн дээд хил) ба QR_PAGE_TOP. */
const PAGE_BOTTOM = 51
const QR_PAGE_TOP = 14

export type FittedCaption = {
  captionW: number
  fontSize: number
  /** `kept` — тайрагдсан үед PDF-д зурагдах мөрийн тоо (0 бол огт гарахгүй); тайраагүй бол null. */
  paragraphs: Array<{ text: string; kept: number | null }>
  /** Хэрэглэгчийн сонгосон өргөн/үсгийг PDF өөрчилсөн эсэх. */
  adjusted: boolean
  clipped: boolean
}

/**
 * Серверийн renderStatementPdf-ийн тайлбар багтаалттай ижил: блок нэг хуудаснаас өндөр бол
 * эхлээд боломжит өргөнөөр, дараа нь үсгийг 0.5pt-ээр 4pt хүртэл жижигрүүлж, бас багтахгүй бол
 * хэрэглэгчийн текстийг бүтэн мөрөөр тайрна (код ба анхааруулга үргэлж үлдэнэ).
 */
export function fitVerificationCaption(v: VerificationBox, orientation: Orientation, measure: Measure, code = VERIFICATION_CODE_PLACEHOLDER): FittedCaption {
  const texts = verificationCaption(code, v.text)
  const g = verificationGeometry(v, orientation)
  const pageRoom = PAGE[orientation].h - PAGE_BOTTOM - QR_PAGE_TOP
  let fontSize = v.fontSize
  let captionW = g.captionW
  const step = () => fontSize * (LINE_HEIGHT_RATIO + VERIFICATION_GAP_RATIO)
  const count = () => texts.map((text) => pdfLineCount(text, captionW, fontSize, measure))
  const height = (lines: number[]) => Math.max(v.size, lines.reduce((sum, n) => sum + n, 0) * step())
  let lines = count()
  if (height(lines) > pageRoom) {
    captionW = g.maxCaptionW
    lines = count()
  }
  while (height(lines) > pageRoom && fontSize > 4) {
    fontSize = Math.max(4, fontSize - 0.5)
    lines = count()
  }
  const clipped = height(lines) > pageRoom
  let kept: Array<number | null> = lines.map(() => null)
  if (clipped) {
    const last = lines.length - 1
    let room = Math.floor(pageRoom / step() + 1e-6) - lines[0]! - lines[last]!
    kept = lines.map((n, i) => {
      if (i === 0 || i === last) return null
      const k = Math.max(0, Math.min(n, room))
      room -= k
      return k < n ? k : null
    })
  }
  return {
    captionW,
    fontSize,
    paragraphs: texts.map((text, i) => ({ text, kept: kept[i] ?? null })),
    adjusted: captionW !== g.captionW || fontSize !== v.fontSize,
    clipped,
  }
}

export const defaultVerification = (orientation: Orientation): VerificationBox => {
  const size = 64
  const contentW = PAGE[orientation].w - MARGIN.left - MARGIN.right
  return {
    x: MARGIN.left,
    gap: 12,
    size,
    w: round(contentW - size - VERIFICATION_CAPTION_GAP),
    fontSize: 6,
    text: defaultVerificationText(),
    hidden: false,
  }
}

export type HeaderDesign = {
  bandHeight: number
  fixed: Record<FixedKind, HeaderBox & { hidden: boolean }>
  /** Толгойн талбарын id → байрлал. */
  fields: Record<string, FieldBox>
  texts: TextBox[]
  verification: VerificationBox
  /**
   * Логоны хайрцгийг ямар харьцаатай (өргөн/өндөр) логонд тааруулсан — null бол "TESO"
   * бичиглэл. Лого солигдоход хайрцгийг шинэ хэлбэрт дахин тааруулахад хэрэглэнэ.
   */
  logoAspect: number | null
}

/** API-ийн `headerLayout` (schema модуль). */
export type HeaderLayoutPayload = {
  bandHeight: number
  elements: Array<
    | (HeaderBox & { kind: FixedKind })
    | (HeaderBox & { kind: 'field'; fieldIndex: number; labelWidth: number })
    | (HeaderBox & { kind: 'text'; text: string })
  >
}

export type Measure = (text: string, fontSize: number, bold?: boolean) => number

export type HeaderContent = {
  title: string
  fields: Array<{ id: string; label: string; value: string }>
  logoLines: string[]
  orientation: Orientation
  /** Оруулсан PNG логоны хэмжээ (px) — байхгүй бол "TESO" бичиглэл. */
  logo?: { width: number; height: number } | null
}

export const lineStep = (kind: HeaderKind, fontSize: number) => fontSize * (LINE_HEIGHT_RATIO + GAP_RATIO[kind])

const round = (value: number) => Math.round(value * 100) / 100
/** Хэмжсэн текстийн хайрцгийг дээш нь бүхэлчилнэ — доош бүхэлчилбэл PDF сүүлийн үсгийг тайрна. */
const roundUp = (value: number) => Math.ceil(value * 100) / 100
const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max)
export const withColon = (label: string) => (label && !label.endsWith(':') ? `${label}:` : label)

/**
 * Браузерт canvas-аар хэмжинэ (Arial нь Arimo-тэй ижил хэмжээстэй). jsdom/SSR-д
 * canvas байхгүй үед дундаж үсгийн өргөнөөр ойролцоолно.
 */
export function createMeasure(): Measure {
  let context: CanvasRenderingContext2D | null = null
  try {
    context = typeof document === 'undefined' ? null : document.createElement('canvas').getContext('2d')
  } catch {
    context = null
  }
  return (text, fontSize, bold = false) => {
    if (!context) return Array.from(text).length * fontSize * 0.56
    context.font = `${bold ? 'bold ' : ''}${fontSize}px Arimo, Arial, Helvetica, sans-serif`
    return context.measureText(text).width
  }
}

/**
 * pdfkit шиг зай/зураасны дараа тасалж хэдэн мөр болохыг тооцно; өргөнөөс урт үгийг
 * тэмдэгтээр тасална. Анхдагч байрлалд урт утга/гарчгийг давхцуулахгүй өрөхөд хэрэглэнэ.
 */
export function wrapLineCount(text: string, width: number, fontSize: number, measure: Measure) {
  if (!text) return 1
  let lines = 0
  for (const paragraph of text.split('\n')) {
    let count = 1
    let current = 0
    for (const word of paragraph.split(/(?<=[\s-])/)) {
      const w = measure(word, fontSize)
      if (current > 0 && current + measure(word.trimEnd(), fontSize) > width) {
        count++
        current = 0
      }
      if (w > width) {
        count += Math.floor(w / width)
        current = w % width
      } else {
        current += w
      }
    }
    lines += count
  }
  return lines
}

const fieldLabelWidth = (labels: string[], measure: Measure) =>
  round(Math.min(150, Math.max(0, ...labels.map((label) => measure(withColon(label.trim()), SIZE.field))) + 4))

/**
 * Серверийн автомат толгойтой ижил анхдагч байрлал: талбарууд зүүн дээд буланд,
 * лого + мэдээлэл баруун дээд буланд, гарчиг хуудасны төвд, огнооны мөр доор нь.
 */
export function defaultHeaderDesign(content: HeaderContent, measure: Measure): HeaderDesign {
  const page = PAGE[content.orientation]
  const left = MARGIN.left
  const right = page.w - MARGIN.right
  const contentW = right - left
  const top = MARGIN.top

  const lines = content.logoLines.map((line) => line.trim()).filter(Boolean)
  // Серверийн автомат толгой (drawLogoBlock) шиг: зураг 124×26 хайрцагт багтана, мэдээлэл яг доор нь.
  const image = content.logo
    ? (() => {
        const scale = Math.min(124 / content.logo.width, 26 / content.logo.height)
        return { w: content.logo.width * scale, h: content.logo.height * scale }
      })()
    : null
  const logoW = image ? roundUp(image.w) : measure('TESO', SIZE.wordmark, true) + 1
  const linesW = Math.min(190, Math.max(0, ...lines.map((line) => measure(line, SIZE.logoLines))))
  const blockW = roundUp(Math.max(logoW, linesW + 1, lines.length > 0 ? 124 : 0))
  const blockX = right - blockW
  const linesTop = top + (image ? image.h : SIZE.wordmark * CONTENT_HEIGHT_RATIO) + 3.3
  const logoBottom = lines.length > 0 ? linesTop + lines.length * lineStep('logoLines', SIZE.logoLines) : top + 26

  const fieldStep = lineStep('field', SIZE.field)
  const labelWidth = fieldLabelWidth(content.fields.map((f) => f.label), measure)
  const fieldW = round(Math.max(60, blockX - left - 16))
  const fields: Record<string, FieldBox> = {}
  // Серверийн автомат толгой шиг ороосон мөрийн тоогоор (3 хүртэл) доош өрнө.
  const fieldRows: Array<{ y0: number; y1: number; x1: number }> = []
  let cursor = top
  for (const field of content.fields) {
    const label = withColon(field.label.trim())
    const value = field.value.trim()
    const valueW = fieldW - labelWidth
    const rows = Math.min(
      MAX_LINES.field ?? 3,
      Math.max(wrapLineCount(label, labelWidth, SIZE.field, measure), wrapLineCount(value, valueW, SIZE.field, measure)),
    )
    fields[field.id] = { x: left, y: round(cursor), w: fieldW, fontSize: SIZE.field, bold: false, align: 'left', labelWidth }
    const x1 = left + (value ? labelWidth + (rows > 1 ? valueW : Math.min(measure(value, SIZE.field), valueW)) : measure(label, SIZE.field))
    fieldRows.push({ y0: cursor, y1: cursor + rows * fieldStep, x1 })
    cursor += rows * fieldStep
  }
  const fieldsBottom = cursor

  const titleText = content.title.trim() || 'Гарчиггүй тайлан'
  const titleW = Math.min(contentW, measure(titleText, SIZE.title) + 4)
  const titleStep = SIZE.title * LINE_HEIGHT_RATIO
  const titleH = titleStep
  const titleX = (page.w - titleW) / 2
  // Серверийн автомат толгойтой адил: гарчгийн өндөрт байгаа талбарын текст эсвэл логотой давхцвал доор шилжинэ.
  const titleBeside =
    titleX > left &&
    titleX + titleW + 6 < blockX &&
    !fieldRows.some((row) => row.y0 < 58.7 + titleH && row.y1 > 58.7 && row.x1 + 6 > titleX)
  const titleLines = titleBeside ? 1 : Math.min(MAX_LINES.title ?? 2, wrapLineCount(titleText, contentW, SIZE.title, measure))
  const titleBox: HeaderBox = titleBeside
    ? { x: round(titleX), y: 58.7, w: round(titleW), fontSize: SIZE.title, bold: true, align: 'center' }
    : {
        x: left,
        y: round(Math.max(fieldsBottom, logoBottom) + 4),
        w: round(contentW),
        fontSize: SIZE.title,
        bold: true,
        align: 'center',
      }

  const periodY = round(Math.max(fieldsBottom, logoBottom, titleBox.y + titleLines * titleStep) + 9.8)
  const third = contentW / 3
  const periodBox = (x: number, w: number, align: ColumnAlign) => ({
    x: round(x),
    y: periodY,
    w: round(w),
    fontSize: SIZE.period,
    bold: true,
    align,
    hidden: false,
  })

  return {
    bandHeight: round(clamp(periodY + SIZE.period * LINE_HEIGHT_RATIO + 1.9, BAND_LIMITS.min, BAND_LIMITS.max)),
    fixed: {
      logo: {
        x: round(blockX),
        y: top,
        // Хайрцаг нь зураг/бичиглэлийн яг хэмжээтэй (серверийн доод хязгаар 8pt) — буланаас томруулахад
        // харьцаа, ирмэг зөв үлдэнэ.
        w: Math.max(LOGO_MIN_W, roundUp(logoW)),
        fontSize: SIZE.wordmark,
        bold: true,
        align: 'left',
        hidden: false,
      },
      logoLines: {
        // Мэдээлэлгүй үед ч хайрцаг баруун margin-аас гарахгүй.
        x: round(right - Math.max(blockW, 60)),
        y: round(linesTop),
        w: Math.max(blockW, 60),
        fontSize: SIZE.logoLines,
        bold: false,
        align: 'left',
        hidden: false,
      },
      title: { ...titleBox, hidden: false },
      periodStart: periodBox(left + 2.2, third - 4.4, 'left'),
      periodEnd: periodBox(left + contentW * 0.4065, third, 'left'),
      printedDate: periodBox(left + third * 2, third - 2.2, 'right'),
    },
    fields,
    texts: [],
    verification: defaultVerification(content.orientation),
    logoAspect: content.logo ? content.logo.width / content.logo.height : null,
  }
}

/** Лого ба доорх мэдээлэл нэг блок (нэг зүүн ирмэгтэй) — хамт шилжинэ, лого солигдоход зүүн ирмэг байрандаа. */
const sharesLeftEdge = (design: HeaderDesign) => Math.abs(design.fixed.logo.x - design.fixed.logoLines.x) < 1

const sameAspect = (a: number | null, b: number | null) => (a === null || b === null ? a === b : Math.abs(a - b) < 0.01)

/**
 * Хэрэглэгчийн засварласан дизайнд лого солигдвол (оруулсан, сольсон, устгасан) логоны
 * хайрцгийг шинэ хэлбэрт тааруулна: баруун ирмэг байрандаа, өндөр нь хэмжээгээр.
 */
function refitLogo(design: HeaderDesign, aspect: number | null, orientation: Orientation, measure: Measure): HeaderDesign {
  const page = PAGE[orientation]
  const box = design.fixed.logo
  const boxH = box.fontSize * LOGO_HEIGHT_RATIO
  const contentW = page.w - MARGIN.left - MARGIN.right
  const wanted = aspect ? boxH * aspect : measure('TESO', box.fontSize, true) + 1
  // Агуулгын өргөнөөс өргөн лого өндрийн хамт жижгэрнэ — хайрцаг зурагтай ижил хэлбэртэй үлдэнэ.
  const fontSize = aspect && wanted > contentW ? round((box.fontSize * contentW) / wanted) : box.fontSize
  const w = round(clamp(wanted, LOGO_MIN_W, contentW))
  // Доорх мэдээллийн мөртэй нэг зүүн ирмэгтэй бол (анхдагч блок) зүүн ирмэг, эс бол баруун ирмэг байрандаа;
  // баруун margin-аас (хэвлэгч тайрдаг) гарахгүй.
  const maxX = page.w - MARGIN.right - w
  const x = round(Math.max(0, Math.min(sharesLeftEdge(design) ? box.x : box.x + box.w - w, maxX)))
  return { ...design, fixed: { ...design.fixed, logo: { ...box, x, w, fontSize } }, logoAspect: aspect }
}

/**
 * "TESO" бичиглэлийн хайрцгийг текстийн өргөнд шахна (бичиглэл байрандаа) — өмнөх загварт
 * хайрцаг нь мэдээллийн мөрийн өргөнтэй байсан тул буланаас томруулахад бичиглэл зүүн тийш гулсдаг.
 */
function hugWordmark(design: HeaderDesign, measure: Measure): HeaderDesign {
  const box = design.fixed.logo
  const w = roundUp(measure('TESO', box.fontSize, true) + 1)
  if (box.w <= w + 0.01) return design
  const x = box.align === 'right' ? box.x + box.w - w : box.align === 'center' ? box.x + (box.w - w) / 2 : box.x
  return { ...design, fixed: { ...design.fixed, logo: { ...box, x: round(x), w } } }
}

/**
 * Хэрэглэгч засварласан дизайн дээр шинээр нэмэгдсэн талбарт байрлал өгнө (сүүлчийн
 * талбарын доор), хасагдсан талбарын байрлалыг хаяна. Цэвэр функц — render бүрт дуудна.
 */
export function resolveHeaderDesign(input: HeaderDesign | null, content: HeaderContent, measure: Measure): HeaderDesign {
  if (!input) return defaultHeaderDesign(content, measure)
  const aspect = content.logo ? content.logo.width / content.logo.height : null
  const refitted = sameAspect(input.logoAspect, aspect) ? input : refitLogo(input, aspect, content.orientation, measure)
  const design = aspect === null ? hugWordmark(refitted, measure) : refitted
  const page = PAGE[content.orientation]
  const known = content.fields.filter((f) => design.fields[f.id])
  const missing = content.fields.filter((f) => !design.fields[f.id])
  if (missing.length === 0 && known.length === Object.keys(design.fields).length) return design

  const fields: Record<string, FieldBox> = {}
  for (const field of known) fields[field.id] = design.fields[field.id]!
  if (missing.length === 0) return { ...design, fields }

  // Тайлангийн хэрэгслүүд шиг сүүлчийн талбарын доор оруулж, түүнээс доорх элементүүдийг
  // шинэ мөрүүдийн өндрөөр доош түлхэнэ — шинэ талбар огноо эсвэл бие биен дээрээ давхцахгүй.
  const fallback = defaultHeaderDesign(content, measure)
  const template = known.length > 0 ? design.fields[known[known.length - 1]!.id]! : null
  const base = template ?? fallback.fields[missing[0]!.id]!
  const step = lineStep('field', base.fontSize)
  const insertY = template ? template.y + step : base.y
  const added = missing.length * step
  missing.forEach((field, i) => {
    fields[field.id] = { ...base, x: round(clamp(base.x, 0, page.w - base.w)), y: round(insertY + i * step) }
  })
  const push = <T extends HeaderBox>(box: T): T => (box.y >= insertY - 0.01 ? { ...box, y: round(box.y + added) } : box)
  for (const field of known) fields[field.id] = push(fields[field.id]!)
  const fixed = Object.fromEntries(FIXED_KINDS.map((kind) => [kind, push(design.fixed[kind])])) as HeaderDesign['fixed']
  return {
    ...design,
    bandHeight: round(clamp(design.bandHeight + added, BAND_LIMITS.min, BAND_LIMITS.max)),
    fixed,
    fields,
    texts: design.texts.map(push),
  }
}

/**
 * QR-ийн тайлбарын текстээс бусад бүх байрлал ижил эсэх — тайлбар нь агуулга (гарчиг шиг тусдаа
 * хадгалагдана), түүнийг засах нь толгойг гар байрлалд шилжүүлэх ёсгүй.
 */
export function sameHeaderLayout(a: HeaderDesign, b: HeaderDesign) {
  const v = a.verification
  const w = b.verification
  return (
    a.bandHeight === b.bandHeight &&
    a.fixed === b.fixed &&
    a.fields === b.fields &&
    a.texts === b.texts &&
    a.logoAspect === b.logoAspect &&
    v.x === w.x &&
    v.gap === w.gap &&
    v.size === w.size &&
    v.w === w.w &&
    v.fontSize === w.fontSize &&
    v.hidden === w.hidden
  )
}

/** Харагдаж буй талбаруудын дарааллаар `fieldIndex` өгнө — payload-ийн headerFields-тэй ижил шүүлттэй байх ёстой. */
export function toHeaderLayout(design: HeaderDesign, visibleFieldIds: string[]): HeaderLayoutPayload {
  const box = (b: HeaderBox, kind: HeaderKind = 'text'): HeaderBox => ({
    x: round(Math.max(0, b.x)),
    y: round(Math.max(0, b.y)),
    w: round(Math.max(8, b.w)),
    fontSize: round(clamp(b.fontSize, sizeLimits(kind).min, sizeLimits(kind).max)),
    bold: b.bold,
    align: b.align,
  })
  const elements: HeaderLayoutPayload['elements'] = []
  for (const kind of FIXED_KINDS) {
    const element = design.fixed[kind]
    if (!element.hidden) elements.push({ kind, ...box(element, kind) })
  }
  visibleFieldIds.forEach((id, fieldIndex) => {
    const element = design.fields[id]
    if (element) {
      const b = box(element)
      elements.push({ kind: 'field', fieldIndex, labelWidth: round(clamp(element.labelWidth, 0, Math.min(842, b.w))), ...b })
    }
  })
  for (const text of design.texts) {
    if (text.text.trim()) elements.push({ kind: 'text', text: text.text.trim().slice(0, 200), ...box(text) })
  }
  return { bandHeight: round(clamp(design.bandHeight, BAND_LIMITS.min, BAND_LIMITS.max)), elements }
}

/** Нуусан бол `undefined` — сервер QR зурахгүй. Хязгаарыг серверийн схемтэй ижил хумина. */
export function toVerificationPayload(v: VerificationBox, orientation: Orientation): VerificationPayload | undefined {
  if (v.hidden) return undefined
  const L = VERIFICATION_LIMITS
  const size = round(clamp(v.size, L.size.min, L.size.max))
  const g = verificationGeometry({ ...v, size }, orientation)
  return {
    x: round(g.x),
    gap: round(clamp(v.gap, L.gap.min, L.gap.max)),
    size,
    w: round(g.captionW),
    fontSize: round(clamp(v.fontSize, L.fontSize.min, L.fontSize.max)),
    text: clampVerificationText(v.text),
  }
}

/**
 * Серверийн verificationGeometry-тэй ижил: QR ба дор хаяж 60pt тайлбар баруун margin дотор
 * багтах хүртэл X-ийг хумьж, тайлбарын өргөнийг үлдсэн зайгаар хязгаарлана.
 */
export function verificationGeometry(v: Pick<VerificationBox, 'x' | 'size' | 'w'>, orientation: Orientation) {
  const rightEdge = PAGE[orientation].w - MARGIN.right
  const minW = VERIFICATION_LIMITS.w.min
  const x = clamp(v.x, 0, Math.max(0, rightEdge - v.size - VERIFICATION_CAPTION_GAP - minW))
  const maxCaptionW = Math.max(minW, rightEdge - (x + v.size + VERIFICATION_CAPTION_GAP))
  return { x, maxX: Math.max(0, rightEdge - v.size - VERIFICATION_CAPTION_GAP - minW), captionW: clamp(v.w, minW, maxCaptionW), maxCaptionW }
}

/** Хэмжээ/өргөн/X өөрчлөгдсөний дараа блокийг хуудсанд буцааж багтаана (хадгалах утга нь хумигдсан). */
export function fitVerification(v: VerificationBox, orientation: Orientation): VerificationBox {
  const g = verificationGeometry(v, orientation)
  return { ...v, x: round(g.x), w: round(g.captionW) }
}

/** Блок хуудсанд багтах хүрээнд (QR + тайлбар) хөдөлнө. */
export function moveVerification(v: VerificationBox, dx: number, dy: number, step: number, orientation: Orientation): VerificationBox {
  const { maxX } = verificationGeometry(v, orientation)
  return {
    ...v,
    x: round(clamp(v.x + snap(dx, step), 0, maxX)),
    gap: round(clamp(v.gap + snap(dy, step), VERIFICATION_LIMITS.gap.min, VERIFICATION_LIMITS.gap.max)),
  }
}

/**
 * Хуудасны чиглэл солиход элементийг ирмэгээр нь бэхэлнэ: зүүн захад байгаа нь (талбарууд)
 * байрандаа, баруун захад тулсан нь (лого, огноо) шинэ баруун зах руу, бусад нь төвөөрөө
 * шилжинэ. Хуудасны өргөний ихэнхийг эзэлсэн хайрцаг агуулгын өргөнтэй хамт сунаж/агшина.
 */
export function adaptHeaderDesign(design: HeaderDesign, from: Orientation, to: Orientation): HeaderDesign {
  if (from === to) return design
  const fromW = PAGE[from].w
  const toW = PAGE[to].w
  const fromContent = fromW - MARGIN.left - MARGIN.right
  const toContent = toW - MARGIN.left - MARGIN.right
  const edge = 6
  const move = <T extends HeaderBox>(b: T, stretch = true): T => {
    const right = b.x + b.w
    const w = stretch && b.w > fromContent * 0.4 ? b.w * (toContent / fromContent) : b.w
    let x: number
    if (b.x <= MARGIN.left + edge) x = b.x
    else if (right >= fromW - MARGIN.right - edge) x = toW - MARGIN.right - (right <= fromW - MARGIN.right ? fromW - MARGIN.right - right : 0) - w
    else x = b.x + b.w / 2 - w / 2 + ((b.x + b.w / 2) / fromW) * (toW - fromW)
    const clampedW = Math.max(12, Math.min(w, toW - MARGIN.right - Math.max(0, x)))
    return { ...b, w: round(clampedW), x: round(clamp(x, 0, toW - clampedW)) }
  }
  const fixed = Object.fromEntries(FIXED_KINDS.map((kind) => [kind, move(design.fixed[kind])])) as HeaderDesign['fixed']
  // Лого харьцаагаа хадгална: өргөн нь сунахгүй, доорх мэдээлэлтэйгээ нэг зүүн ирмэгтэй бол хамт шилжинэ,
  // шинэ хуудсанд багтахгүй бол өндрийн хамт жижгэрнэ.
  const logo = design.fixed.logo
  const lines = design.fixed.logoLines
  // Нуусан мэдээлэл ч байрлалаа хадгалдаг (нэг товчоор буцааж гаргана) тул хамт шилжинэ.
  const placed = Math.abs(logo.x - lines.x) < 1 ? { ...logo, x: fixed.logoLines.x } : move(logo, false)
  const fitW = Math.max(12, Math.min(logo.w, toW - MARGIN.right - Math.max(0, placed.x), toW))
  fixed.logo = {
    ...placed,
    x: round(clamp(placed.x, 0, toW - fitW)),
    w: round(fitW),
    fontSize: fitW < logo.w - 0.01 ? round((logo.fontSize * fitW) / logo.w) : logo.fontSize,
  }
  const fields = Object.fromEntries(Object.entries(design.fields).map(([id, b]) => [id, move(b)]))
  // QR блок (QR + тайлбар) нэг хайрцаг мэт ирмэгээрээ бэхлэгдэнэ; тайлбар агуулгын өргөнтэй хамт сунана.
  const v = design.verification
  const block = move({ x: v.x, y: 0, w: v.size + VERIFICATION_CAPTION_GAP + v.w, fontSize: v.fontSize, bold: false, align: 'left' })
  const verification = fitVerification(
    {
      ...v,
      x: block.x,
      w: round(clamp(block.w - v.size - VERIFICATION_CAPTION_GAP, VERIFICATION_LIMITS.w.min, VERIFICATION_LIMITS.w.max)),
    },
    to,
  )
  return { ...design, fixed, fields, texts: design.texts.map((t) => move(t)), verification }
}

/** localStorage-д талбарын id биш дарааллаар хадгална — id нь session бүрт шинээр үүсдэг. */
export type SavedHeaderDesign = Omit<HeaderDesign, 'fields'> & { fields: Array<FieldBox | null> }

export const serializeHeaderDesign = (design: HeaderDesign, fieldIds: string[]): SavedHeaderDesign => ({
  ...design,
  fields: fieldIds.map((id) => design.fields[id] ?? null),
})

const ALIGNS: ColumnAlign[] = ['left', 'center', 'right']
const num = (value: unknown, min: number, max: number) =>
  typeof value === 'number' && Number.isFinite(value) ? clamp(value, min, max) : null

function parseBox(raw: unknown, kind: HeaderKind = 'text'): HeaderBox | null {
  if (!raw || typeof raw !== 'object') return null
  const b = raw as Record<string, unknown>
  const x = num(b.x, 0, PAGE.landscape.w)
  const y = num(b.y, 0, BAND_LIMITS.max)
  const w = num(b.w, 8, PAGE.landscape.w)
  const fontSize = num(b.fontSize, sizeLimits(kind).min, sizeLimits(kind).max)
  if (x === null || y === null || w === null || fontSize === null) return null
  return {
    x,
    y,
    w,
    fontSize,
    bold: b.bold === true,
    align: ALIGNS.includes(b.align as ColumnAlign) ? (b.align as ColumnAlign) : 'left',
  }
}

/** Хадгалсан дизайныг (гараар засагдсан байж болно) шалгаж шинэ талбарын id-тай холбоно. */
export function restoreHeaderDesign(raw: unknown, fieldIds: string[]): HeaderDesign | null {
  if (!raw || typeof raw !== 'object') return null
  const saved = raw as Record<string, unknown>
  const bandHeight = num(saved.bandHeight, BAND_LIMITS.min, BAND_LIMITS.max)
  const fixedRaw = (saved.fixed ?? {}) as Record<string, unknown>
  if (bandHeight === null) return null
  const fixed = {} as HeaderDesign['fixed']
  for (const kind of FIXED_KINDS) {
    const box = parseBox(fixedRaw[kind], kind)
    if (!box) return null
    fixed[kind] = { ...box, hidden: (fixedRaw[kind] as { hidden?: unknown }).hidden === true }
  }
  const fields: Record<string, FieldBox> = {}
  const savedFields = Array.isArray(saved.fields) ? saved.fields : []
  fieldIds.forEach((id, i) => {
    const box = parseBox(savedFields[i])
    if (box) fields[id] = { ...box, labelWidth: num((savedFields[i] as { labelWidth?: unknown }).labelWidth, 0, 400) ?? 0 }
  })
  const texts = (Array.isArray(saved.texts) ? saved.texts : [])
    .slice(0, HEADER_TEXT_LIMIT)
    .flatMap((raw: unknown, i: number) => {
      const box = parseBox(raw)
      const text = (raw as { text?: unknown })?.text
      return box && typeof text === 'string' ? [{ ...box, id: `text-${i}`, text: text.slice(0, 200) }] : []
    })
  const aspect = saved.logoAspect
  return {
    bandHeight,
    fixed,
    fields,
    texts,
    verification: parseVerification(saved.verification),
    // Хуучин хадгалсан загварт байхгүй — "TESO" бичиглэлд тааруулсан гэж үзнэ; лого байвал дахин тааруулагдана.
    logoAspect: typeof aspect === 'number' && Number.isFinite(aspect) && aspect > 0 ? aspect : null,
  }
}

/** Хуучин (QR-гүй) хадгалсан загварт анхдагч блок өгнө. */
function parseVerification(raw: unknown): VerificationBox {
  const fallback = defaultVerification('portrait')
  if (!raw || typeof raw !== 'object') return fallback
  const v = raw as Record<string, unknown>
  const L = VERIFICATION_LIMITS
  return {
    x: num(v.x, 0, PAGE.landscape.w) ?? fallback.x,
    gap: num(v.gap, L.gap.min, L.gap.max) ?? fallback.gap,
    size: num(v.size, L.size.min, L.size.max) ?? fallback.size,
    w: num(v.w, L.w.min, L.w.max) ?? fallback.w,
    fontSize: num(v.fontSize, L.fontSize.min, L.fontSize.max) ?? fallback.fontSize,
    // Хуучин хадгалсан загварт байхгүй — анхдагч тайлбар.
    text: typeof v.text === 'string' ? clampVerificationText(v.text) : fallback.text,
    hidden: v.hidden === true,
  }
}

/** Урьдчилан харагдацын px / PDF pt (880px өргөн A4 босоо цаас). */
export const PREVIEW_PX = 880 / PAGE.portrait.w

export type ElementKey = `fixed:${FixedKind}` | `field:${string}` | `text:${string}`

export const FIXED_LABELS: Record<FixedKind, string> = {
  title: 'Гарчиг',
  logo: 'Лого',
  logoLines: 'Логоны доорх мэдээлэл',
  periodStart: 'Эхлэх огноо',
  periodEnd: 'Дуусах огноо',
  printedDate: 'Одоогийн огноо',
}

export function kindOf(key: ElementKey): HeaderKind {
  if (key.startsWith('field:')) return 'field'
  if (key.startsWith('text:')) return 'text'
  return key.slice('fixed:'.length) as FixedKind
}

export function getBox(design: HeaderDesign, key: ElementKey): HeaderBox | null {
  const id = key.slice(key.indexOf(':') + 1)
  if (key.startsWith('field:')) return design.fields[id] ?? null
  if (key.startsWith('text:')) return design.texts.find((t) => t.id === id) ?? null
  return design.fixed[id as FixedKind] ?? null
}

export function updateBox(design: HeaderDesign, key: ElementKey, patch: Partial<FieldBox & { text: string; hidden: boolean }>): HeaderDesign {
  const id = key.slice(key.indexOf(':') + 1)
  if (key.startsWith('field:')) {
    const current = design.fields[id]
    return current ? { ...design, fields: { ...design.fields, [id]: { ...current, ...patch } } } : design
  }
  if (key.startsWith('text:')) {
    return { ...design, texts: design.texts.map((t) => (t.id === id ? { ...t, ...patch } : t)) }
  }
  const kind = id as FixedKind
  return { ...design, fixed: { ...design.fixed, [kind]: { ...design.fixed[kind], ...patch } } }
}

/** Харагдаж буй бүх элементийн түлхүүр — зурах дараалал, хамгийн доод ирмэг тооцоход. */
export function visibleKeys(design: HeaderDesign): ElementKey[] {
  return [
    ...FIXED_KINDS.filter((kind) => !design.fixed[kind].hidden).map((kind) => `fixed:${kind}` as const),
    ...Object.keys(design.fields).map((id) => `field:${id}` as const),
    ...design.texts.map((t) => `text:${t.id}` as const),
  ]
}

/** Шилжилтийг (байрлалыг биш) торд тааруулна — анхдагч 20.16 мэт байрлалын тэгшлэлт алдагдахгүй. */
const snap = (delta: number, step: number) => (step > 0 ? Math.round(delta / step) * step : delta)

type Bounds = { pageW: number; heightOf: (key: ElementKey) => number }

export function moveElement(design: HeaderDesign, key: ElementKey, dx: number, dy: number, step: number, bounds: Bounds): HeaderDesign {
  const box = getBox(design, key)
  if (!box) return design
  const h = Math.max(bounds.heightOf(key), 1)
  return updateBox(design, key, {
    x: round(clamp(box.x + snap(dx, step), 0, Math.max(0, bounds.pageW - box.w))),
    y: round(clamp(box.y + snap(dy, step), 0, Math.max(0, design.bandHeight - h))),
  })
}

export function resizeElement(design: HeaderDesign, key: ElementKey, dw: number, step: number, bounds: Bounds): HeaderDesign {
  const box = getBox(design, key)
  if (!box) return design
  return updateBox(design, key, { w: round(clamp(box.w + snap(dw, step), 12, bounds.pageW - box.x)) })
}

export type LogoCorner = 'left' | 'right'

/**
 * Логог харьцаагаар нь `scale` дахин томруулна: өргөн ба хэмжээ (өндөр) ижил харьцаагаар,
 * `anchor` ирмэг байрандаа. Хэмжээний хязгаар, хуудасны ирмэг, толгойн дээд өндөрт багтаахын
 * тулд харьцааг хумина — хэзээ ч зөвхөн нэг талаараа хумигдаж хэлбэр алдагдахгүй.
 */
/** Хуудасны баруун хагаст байгаа лого баруун ирмэгээрээ бэхлэгдэж томорно. */
export const logoAnchor = (design: HeaderDesign, pageW: number): 'left' | 'right' =>
  design.fixed.logo.x + design.fixed.logo.w / 2 > pageW / 2 ? 'right' : 'left'

/**
 * Логог харьцаагаар нь томруулж/жижигрүүлж болох хүрээ (одоогийн хэмжээний үржвэр). Хязгаараас
 * аль хэдийн хэтэрсэн хайрцгийг (хуучин загвар) хүчээр жижигрүүлэхгүй — max ≥ 1, min ≤ 1.
 * Хэрэгслийн мөрийн тоон талбарууд ч энэ хүрээг ашигладаг: бичиж буй "1" гэх мэт эхлэл хэрэглэгдэхгүй.
 */
export function logoScaleBounds(design: HeaderDesign, anchor: 'left' | 'right', pageW: number) {
  const box = design.fixed.logo
  const h = box.fontSize * LOGO_HEIGHT_RATIO
  // Зурагтай бол өргөнийг зургийн харьцаагаар тооцно — 8pt-ийн доод хязгаарт хүрсэн хайрцгийг дахин
  // томруулахад хэлбэр алдагдахгүй. "TESO" бичиглэлд хайрцаг нь текстийн өргөнтэй.
  const baseW = design.logoAspect ? h * design.logoAspect : box.w
  const room = anchor === 'right' ? box.x + box.w : pageW - box.x
  return {
    baseW,
    min: Math.min(LOGO_SIZE_LIMITS.min / box.fontSize, 1),
    max: Math.max(1, Math.min(LOGO_SIZE_LIMITS.max / box.fontSize, room / baseW, Math.max(BAND_LIMITS.max - box.y, 1) / h)),
  }
}

/**
 * Логог харьцаагаар нь `scale` дахин томруулна: өргөн ба хэмжээ (өндөр) ижил харьцаагаар,
 * `anchor` ирмэг байрандаа. Хайрцаг серверийн доод хязгаар 8pt-ээс нарийсахгүй (зураг дотор нь багтана).
 */
function applyLogoScale(design: HeaderDesign, scale: number, anchor: 'left' | 'right', step: number, pageW: number): HeaderDesign {
  const box = design.fixed.logo
  const h = box.fontSize * LOGO_HEIGHT_RATIO
  const anchorRight = box.x + box.w
  const { min, max, baseW } = logoScaleBounds(design, anchor, pageW)
  let s = clamp(scale, min, max)
  // Торд өндрийг (pt) тааруулна — өргөн нь харьцаагаар дагана.
  if (step > 0) s = clamp(snap(h * s, step) / h, min, max)
  const w = Math.max(LOGO_MIN_W, roundUp(baseW * s))
  const fontSize = round(box.fontSize * s)
  const x = anchor === 'right' ? round(clamp(anchorRight - w, 0, pageW - w)) : box.x
  return updateBox(design, 'fixed:logo', { x, w, fontSize })
}

/**
 * Логог доод булангаас нь чирж харьцаагаар нь томруулна/жижигрүүлнэ. Баруун булан зүүн
 * ирмэгийг, зүүн булан баруун ирмэгийг (баруун дээд буланд байрлах логод) байранд нь үлдээнэ.
 * Чирсэн булангийн шилжилтийг хайрцгийн диагональ дээр буулгаж харьцааг олно.
 */
export function scaleLogo(design: HeaderDesign, corner: LogoCorner, dx: number, dy: number, step: number, pageW: number): HeaderDesign {
  const box = design.fixed.logo
  const h = box.fontSize * LOGO_HEIGHT_RATIO
  const sx = corner === 'left' ? -dx : dx
  const scale = ((box.w + sx) * box.w + (h + dy) * h) / (box.w * box.w + h * h)
  return applyLogoScale(design, scale, corner === 'left' ? 'right' : 'left', step, pageW)
}

/**
 * Хэрэгслийн мөрөөс өндөр эсвэл өргөнийг (pt) оруулахад харьцаагаар нь томруулна: хуудасны
 * баруун хагаст байгаа лого баруун ирмэгээрээ бэхлэгдэнэ.
 */
export function setLogoSize(design: HeaderDesign, size: { height: number } | { width: number }, pageW: number): HeaderDesign {
  const box = design.fixed.logo
  const anchor = logoAnchor(design, pageW)
  const { baseW } = logoScaleBounds(design, anchor, pageW)
  const scale = 'width' in size ? size.width / baseW : size.height / (box.fontSize * LOGO_HEIGHT_RATIO)
  return applyLogoScale(design, scale, anchor, 0, pageW)
}

/** Хүснэгт эхлэх шугам аль ч элементийн дээгүүр гарахгүй. */
export function resizeBand(design: HeaderDesign, dy: number, step: number, bounds: Bounds): HeaderDesign {
  const lowest = Math.max(0, ...visibleKeys(design).map((key) => (getBox(design, key)?.y ?? 0) + bounds.heightOf(key)))
  const min = Math.max(BAND_LIMITS.min, Math.ceil(lowest * 2) / 2)
  return { ...design, bandHeight: round(clamp(design.bandHeight + snap(dy, step), min, BAND_LIMITS.max)) }
}

export function addTextElement(design: HeaderDesign, id: string, orientation: Orientation): HeaderDesign {
  const fontSize = SIZE.text
  const h = lineStep('text', fontSize)
  return {
    ...design,
    texts: [
      ...design.texts,
      {
        id,
        text: 'Текст',
        x: MARGIN.left,
        y: round(clamp(design.bandHeight - h * 2 - 4, 0, design.bandHeight - h)),
        w: round(Math.min(180, PAGE[orientation].w - MARGIN.left - MARGIN.right)),
        fontSize,
        bold: false,
        align: 'left',
      },
    ],
  }
}
