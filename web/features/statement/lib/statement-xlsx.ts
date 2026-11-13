import * as XLSX from 'xlsx'

/** API талын `STATEMENT_LIMITS`-тэй ижил байх ёстой. */
export const STATEMENT_LIMITS = {
  columns: 16,
  rows: 10_000,
  headerFields: 12,
  logoLines: 6,
  logoLineLength: 80,
  summaryRows: 6,
  cellLength: 500,
  /** express.json 2mb — JSON-ийн толгой/escape-д зай үлдээнэ. */
  payloadBytes: 1_900_000,
} as const

export type CellFormat = 'text' | 'number' | 'date' | 'time'
export type DatePattern = 'MM/DD/YYYY' | 'YYYY-MM-DD' | 'YYYY.MM.DD' | 'DD.MM.YYYY'
export type ColumnAlign = 'left' | 'center' | 'right'
export type Orientation = 'portrait' | 'landscape'

export const CELL_FORMATS: Array<{ value: CellFormat; label: string }> = [
  { value: 'text', label: 'Текст (Excel-ээр)' },
  { value: 'number', label: 'Тоо (1,234.50)' },
  { value: 'date', label: 'Огноо' },
  { value: 'time', label: 'Цаг (ЦЦ:ММ)' },
]

export const DATE_PATTERNS: DatePattern[] = ['MM/DD/YYYY', 'YYYY-MM-DD', 'YYYY.MM.DD', 'DD.MM.YYYY']

export type RawCell = {
  t: XLSX.ExcelDataType
  v: unknown
  w?: string
  z?: string | number
  /** Томьёотой боловч хадгалагдсан утгагүй нүд (жишээ нь скриптээр үүсгэсэн файл). */
  uncached?: boolean
} | null

export type ParsedSheet = {
  name: string
  /** rows[r][c] — r нь Excel-ийн мөр − 1, c нь баганын индекс (A = 0). */
  rows: RawCell[][]
  colCount: number
  /** 1904 огнооны системтэй (хуучин Mac Excel) ном — serial-ийг өөрөөр хөрвүүлнэ. */
  date1904: boolean
  /** Excel-д нуусан/шүүлтүүрээр далдлагдсан мөрүүдийн индекс. */
  hiddenRows: number[]
}

export type StatementColumnConfig = {
  id: string
  label: string
  /** Excel-ийн баганын индекс; `null` — хоосон багана. */
  source: number | null
  format: CellFormat
  align: ColumnAlign
  width: number
}

export type SheetLayout = {
  /** Толгой мөрийн индекс (0-ээс), байхгүй бол `null`. */
  headerRow: number | null
  dataStart: number
  dataEnd: number
  /** `dataEnd`-ийн дараах хураангуй мөрүүд ("Нийт дүн", "Эцсийн үлдэгдэл"). */
  summaryRows: number[]
}

export type SummaryRowPayload = { label: string; cells: string[] }

let idCounter = 0
export const newColumnId = () => `col-${Date.now().toString(36)}-${(idCounter++).toString(36)}`

/**
 * Жишиг хуулгын 11 багана — Excel-ийн баганыг дарааллаар нь тааруулна. Өргөн нь
 * template.pdf-ийн хүснэгтээс хэмжсэн pt/10 (нийт 54.575); харьцаагаар хуваарилагдана.
 */
export const DEFAULT_COLUMN_TEMPLATE: Array<Omit<StatementColumnConfig, 'id' | 'source'>> = [
  { label: '№', format: 'text', align: 'right', width: 2.1 },
  { label: 'Гүйлгээний огноо', format: 'date', align: 'center', width: 3.78 },
  { label: 'Салбар №', format: 'text', align: 'center', width: 2.65 },
  { label: 'Журнал №', format: 'text', align: 'center', width: 3.25 },
  { label: 'Харьцсан данс', format: 'text', align: 'center', width: 7.16 },
  { label: 'Цаг', format: 'time', align: 'center', width: 2.13 },
  { label: 'Гүйлгээний утга', format: 'text', align: 'left', width: 14.01 },
  { label: 'Орлого', format: 'number', align: 'right', width: 4.73 },
  { label: 'Зарлага', format: 'number', align: 'right', width: 5.18 },
  { label: 'Үлдэгдэл', format: 'number', align: 'right', width: 5.58 },
  { label: 'Тооцох огноо', format: 'date', align: 'center', width: 4.0 },
]

export const DEFAULT_HEADER_LABELS = ['Харилцагчийн нэр', 'Дансны дугаар', 'Дансны төрөл', 'Валютын төрөл', 'Салбар']

export const columnLetter = (index: number) => XLSX.utils.encode_col(index)

export function parseStatementWorkbook(data: ArrayBuffer): ParsedSheet[] {
  // cellNF: огноо/цагийг таних number format (`z`) хэрэгтэй. cellDates-ийг
  // ашиглахгүй — JS Date нь цагийн бүсээр нэг өдөр шилжих эрсдэлтэй.
  // sheetStubs: скриптээр бичсэн файлын утгагүй томьёо нүд ('z' stub) алга болохгүйн тулд.
  // cellStyles: нуусан мөрийг (`!rows[r].hidden`) уншихад хэрэгтэй.
  const workbook = XLSX.read(new Uint8Array(data), {
    type: 'array',
    cellNF: true,
    cellFormula: true,
    sheetStubs: true,
    cellStyles: true,
  })
  const date1904 = Boolean(workbook.Workbook?.WBProps?.date1904)
  return workbook.SheetNames.map((name) => {
    const sheet = workbook.Sheets[name]!
    const ref = sheet['!ref']
    if (!ref) return { name, rows: [], colCount: 0, date1904, hiddenRows: [] }
    const range = XLSX.utils.decode_range(ref)
    const rows: RawCell[][] = []
    for (let r = 0; r <= range.e.r; r++) {
      const row: RawCell[] = []
      for (let c = 0; c <= range.e.c; c++) {
        const cell = r < range.s.r || c < range.s.c ? undefined : sheet[XLSX.utils.encode_cell({ r, c })]
        const uncached = Boolean(cell?.f) && (cell?.t === 'z' || cell?.v === undefined)
        if (!cell || (!uncached && (cell.t === 'z' || cell.v === undefined))) {
          row.push(null)
          continue
        }
        row.push(uncached ? { t: 'z', v: undefined, uncached: true } : { t: cell.t, v: cell.v, w: cell.w, z: cell.z })
      }
      rows.push(row)
    }
    const hiddenRows = (sheet['!rows'] ?? []).flatMap((info, r) => (info?.hidden ? [r] : []))
    return { name, rows, colCount: range.e.c + 1, date1904, hiddenRows }
  })
}

const isBlank = (cell: RawCell) => {
  if (!cell) return true
  // Томьёо байгаа, зөвхөн утга нь хадгалагдаагүй — бүтэц таних үед хоосон гэж үзэхгүй.
  if (cell.uncached) return false
  if (cell.t === 'z') return true
  return typeof cell.v === 'string' && cell.v.trim() === ''
}

const nonEmptyCount = (row: RawCell[] | undefined) => (row ?? []).filter((cell) => !isBlank(cell)).length

const firstNonEmpty = (row: RawCell[] | undefined) => {
  const index = (row ?? []).findIndex((cell) => !isBlank(cell))
  return index === -1 ? null : { index, cell: row![index]! }
}

const NUMERIC_LIKE = /^[\s+\-(]*[\d.,\s]+[)\s]*$/
const DATE_LIKE = /^\s*\d{1,4}[./-]\d{1,2}[./-]\d{1,4}/

const isTextLabel = (cell: NonNullable<RawCell>) =>
  cell.t === 's' &&
  typeof cell.v === 'string' &&
  cell.v.trim() !== '' &&
  !NUMERIC_LIKE.test(cell.v) &&
  !DATE_LIKE.test(cell.v)

const median = (values: number[]) => {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]!
}

/**
 * Толгой мөр, өгөгдлийн муж, төгсгөлийн хураангуй мөрийг таамаглана.
 * Хэрэглэгч UI дээр засах боломжтой тул энд зөвхөн боломжит анхны утга.
 */
export function detectSheetLayout(sheet: ParsedSheet): SheetLayout {
  const nonEmptyRows = sheet.rows.map((row, index) => ({ index, count: nonEmptyCount(row) })).filter((r) => r.count > 0)
  if (nonEmptyRows.length === 0) return { headerRow: null, dataStart: 0, dataEnd: -1, summaryRows: [] }

  const first = nonEmptyRows[0]!
  const second = nonEmptyRows[1]
  const firstCells = sheet.rows[first.index]!.filter((cell) => !isBlank(cell)) as Array<NonNullable<RawCell>>
  const secondHasNumbers = second
    ? sheet.rows[second.index]!.some((cell) => cell && !isBlank(cell) && cell.t === 'n')
    : false
  const headerRow = firstCells.every((cell) => cell.t === 's') && secondHasNumbers ? first.index : null

  const dataRows = nonEmptyRows.filter((r) => headerRow === null || r.index > headerRow)
  if (dataRows.length === 0) return { headerRow, dataStart: (headerRow ?? 0) + 1, dataEnd: headerRow ?? 0, summaryRows: [] }

  const typical = median(dataRows.slice(0, 50).map((r) => r.count))
  const summaryRows: number[] = []
  for (let i = dataRows.length - 1; i > 0 && summaryRows.length < STATEMENT_LIMITS.summaryRows; i--) {
    const candidate = dataRows[i]!
    const lead = firstNonEmpty(sheet.rows[candidate.index])
    // Нарийн (2-3 баганатай) хүснэгтэд сүүлийн жирийн мөрийг хураангуй гэж андуурахгүйн тулд хатуу бага.
    const sparse = candidate.count < typical && candidate.count <= Math.max(3, Math.floor(typical / 2))
    if (!lead || !sparse || !isTextLabel(lead.cell)) break
    summaryRows.unshift(candidate.index)
  }
  const lastData = dataRows[dataRows.length - 1 - summaryRows.length]!
  return { headerRow, dataStart: dataRows[0]!.index, dataEnd: lastData.index, summaryRows }
}

/** Хэрэглэгч дуусах мөрийг өөрчлөхөд түүний дараах хоосон бус мөрүүд хураангуй болно. */
export function trailingRows(sheet: ParsedSheet, dataEnd: number): number[] {
  const out: number[] = []
  for (let r = dataEnd + 1; r < sheet.rows.length && out.length < STATEMENT_LIMITS.summaryRows; r++) {
    if (nonEmptyCount(sheet.rows[r]) > 0) out.push(r)
  }
  return out
}

/** Мужийн дотор дор хаяж нэг утгатай баганууд — байрлалаар тааруулахад ашиглана. */
export function usedColumns(sheet: ParsedSheet, layout: SheetLayout): number[] {
  const used: number[] = []
  for (let c = 0; c < sheet.colCount; c++) {
    for (let r = layout.dataStart; r <= layout.dataEnd; r++) {
      if (!isBlank(sheet.rows[r]?.[c] ?? null)) {
        used.push(c)
        break
      }
    }
  }
  return used
}

const normalizeHeader = (value: string) => value.trim().toLowerCase().replace(/\s+/g, ' ')

export function headerText(sheet: ParsedSheet, layout: SheetLayout, column: number): string {
  if (layout.headerRow === null) return ''
  return cellText(sheet.rows[layout.headerRow]?.[column] ?? null)
}

/**
 * Толгой мөр байвал эхлээд яг ижил нэрээр, дараа нь агуулсан нэрээр (3+ тэмдэгт)
 * тааруулна; таараагүй багана хоосон үлдэнэ. Толгойгүй бол ашиглагдсан баганын дарааллаар.
 */
export function autoMapColumns(
  template: Array<Omit<StatementColumnConfig, 'id' | 'source'>>,
  sheet: ParsedSheet,
  layout: SheetLayout,
): StatementColumnConfig[] {
  const used = usedColumns(sheet, layout)
  const mapped: StatementColumnConfig[] = template.map((column) => ({ ...column, id: newColumnId(), source: null }))
  if (layout.headerRow === null) {
    mapped.forEach((column, i) => {
      column.source = used[i] ?? null
    })
    return mapped
  }
  const headers = new Map(used.map((c) => [c, normalizeHeader(headerText(sheet, layout, c))]))
  const taken = new Set<number>()
  const assign = (matches: (header: string, wanted: string) => boolean) => {
    for (const column of mapped) {
      if (column.source !== null) continue
      const wanted = normalizeHeader(column.label)
      if (!wanted) continue
      const match = used.find((c) => !taken.has(c) && headers.get(c) !== '' && matches(headers.get(c)!, wanted))
      if (match !== undefined) {
        column.source = match
        taken.add(match)
      }
    }
  }
  assign((header, wanted) => header === wanted)
  // "№" мэт богино нэр "Салбар №"-ийг булаахгүйн тулд хоёр тал нь 3+ тэмдэгт байх ёстой.
  assign(
    (header, wanted) =>
      header.length >= 3 && wanted.length >= 3 && (header.includes(wanted) || wanted.includes(header)),
  )
  return mapped
}

/** Excel-ийн өгөгдлөөс баганын формат/байрлал/өргөнийг таамаглана. */
function guessColumn(sheet: ParsedSheet, layout: SheetLayout, column: number): Omit<StatementColumnConfig, 'id'> {
  let numbers = 0
  let dates = 0
  let times = 0
  let texts = 0
  let totalLength = 0
  let samples = 0
  for (let r = layout.dataStart; r <= layout.dataEnd && samples < 100; r++) {
    const cell = sheet.rows[r]?.[column] ?? null
    if (isBlank(cell) || !cell || cell.uncached) continue
    samples++
    const text = cellText(cell)
    totalLength += text.length
    if (typeof cell.v === 'number' && isDateFormat(cell.z)) {
      if (cell.v < 1) times++
      else dates++
    } else if (typeof cell.v === 'number') {
      numbers++
    } else {
      texts++
    }
  }
  const label = headerText(sheet, layout, column).replace(/\s+/g, ' ').trim() || columnLetter(column)
  const top = Math.max(numbers, dates, times, texts)
  const format: CellFormat =
    samples === 0 || top === texts ? 'text' : top === dates ? 'date' : top === times ? 'time' : 'number'
  const align: ColumnAlign = format === 'number' ? 'right' : format === 'text' ? 'left' : 'center'
  const avg = samples ? totalLength / samples : label.length
  const width = Math.round(Math.min(3.5, Math.max(0.6, avg / 8)) * 20) / 20
  return { label: label.slice(0, 60), source: column, format, align, width }
}

/** Толгой мөртэй дурын файлд: PDF-ийн багана бүр Excel-ийн нэг багана, нэр нь толгойн текст. */
export function columnsFromHeaders(sheet: ParsedSheet, layout: SheetLayout): StatementColumnConfig[] {
  return usedColumns(sheet, layout)
    .slice(0, STATEMENT_LIMITS.columns)
    .map((c) => ({ ...guessColumn(sheet, layout, c), id: newColumnId() }))
}

const pad = (n: number) => String(n).padStart(2, '0')

const applyDatePattern = (y: number, m: number, d: number, pattern: DatePattern) => {
  switch (pattern) {
    case 'YYYY-MM-DD':
      return `${y}-${pad(m)}-${pad(d)}`
    case 'YYYY.MM.DD':
      return `${y}.${pad(m)}.${pad(d)}`
    case 'DD.MM.YYYY':
      return `${pad(d)}.${pad(m)}.${y}`
    default:
      return `${pad(m)}/${pad(d)}/${y}`
  }
}

// Intl нь хамгийн богино аравтын дүрслэлээр half-expand дугуйлдаг — Excel шиг 1.005 → 1.01.
const AMOUNT_FORMAT = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export const formatAmount = (value: number) => {
  const text = AMOUNT_FORMAT.format(value)
  return text === '-0.00' ? '0.00' : text
}

const isDateFormat = (z: string | number | undefined) => typeof z === 'string' && z !== 'General' && XLSX.SSF.is_date(z)

/** Excel-д харагдаж буй текст — том бүхэл тоог "1.0026E+11" болгохгүй. */
export function cellText(cell: RawCell): string {
  if (!cell || cell.uncached) return ''
  if (cell.t === 'e') return cell.w ?? '#ERROR'
  if (typeof cell.v === 'number') {
    if (isDateFormat(cell.z)) return cell.w ?? String(cell.v)
    const plain = cell.z === undefined || cell.z === 'General' || cell.z === '0' || cell.z === '@'
    if (Number.isInteger(cell.v) && plain) return String(cell.v)
    return cell.w ?? String(cell.v)
  }
  if (typeof cell.v === 'boolean') return cell.w ?? (cell.v ? 'TRUE' : 'FALSE')
  return String(cell.w ?? cell.v ?? '')
}

/** Тоон утгыг сонгосон форматаар; текст утгыг Excel-д байгаагаар нь үлдээнэ. */
export function formatCell(cell: RawCell, format: CellFormat, datePattern: DatePattern, date1904 = false): string {
  if (!cell || cell.uncached) return ''
  if (cell.t === 'e' || typeof cell.v !== 'number') return cellText(cell).trim()
  const value = cell.v
  switch (format) {
    case 'number':
      return formatAmount(value)
    case 'date': {
      const parsed = XLSX.SSF.parse_date_code(value, { date1904 })
      return parsed ? applyDatePattern(parsed.y, parsed.m, parsed.d, datePattern) : cellText(cell)
    }
    case 'time': {
      const parsed = XLSX.SSF.parse_date_code(value % 1)
      return parsed ? `${pad(parsed.H)}:${pad(parsed.M)}` : cellText(cell)
    }
    default:
      return cellText(cell).trim()
  }
}

/** Хэрэглэгчийн гараар оруулсан утга — тоон баганад тоо бол форматлана. */
export function formatManualValue(raw: string, format: CellFormat): string {
  const trimmed = raw.trim()
  if (format !== 'number' || trimmed === '') return trimmed
  const numeric = Number(trimmed.replace(/[,\s]/g, ''))
  return Number.isFinite(numeric) ? formatAmount(numeric) : trimmed
}

const clip = (value: string) => (value.length > STATEMENT_LIMITS.cellLength ? value.slice(0, STATEMENT_LIMITS.cellLength) : value)

export type CellSpec = Pick<StatementColumnConfig, 'source' | 'format'>

export type BuiltStatementRows = {
  rows: string[][]
  afterRows: SummaryRowPayload[]
  /** Алгассан нуусан мөрийн тоо. */
  hiddenSkipped: number
  /** Томьёоны алдаатай (#REF! гэх мэт) нүдний тоо. */
  errorCells: number
  /** Томьёотой боловч хадгалагдсан утгагүй нүдний тоо. */
  uncachedCells: number
  clippedCells: number
}

export function buildStatementRows(
  sheet: ParsedSheet,
  layout: SheetLayout,
  columns: CellSpec[],
  options: { datePattern: DatePattern; includeSummary: boolean; includeHidden?: boolean },
): BuiltStatementRows {
  const hidden = options.includeHidden ? new Set<number>() : new Set(sheet.hiddenRows)
  let hiddenSkipped = 0
  let errorCells = 0
  let uncachedCells = 0
  let clippedCells = 0
  const toCell = (cell: RawCell, column: CellSpec) => {
    if (cell?.t === 'e') errorCells++
    if (cell?.uncached) uncachedCells++
    const text = formatCell(cell, column.format, options.datePattern, sheet.date1904)
    if (text.length > STATEMENT_LIMITS.cellLength) clippedCells++
    return clip(text)
  }

  const rows: string[][] = []
  for (let r = layout.dataStart; r <= layout.dataEnd; r++) {
    const raw = sheet.rows[r]
    if (!raw || nonEmptyCount(raw) === 0) continue
    if (hidden.has(r)) {
      hiddenSkipped++
      continue
    }
    rows.push(columns.map((column) => (column.source === null ? '' : toCell(raw[column.source] ?? null, column))))
  }

  const afterRows: SummaryRowPayload[] = []
  if (options.includeSummary) {
    for (const r of layout.summaryRows) {
      const raw = sheet.rows[r]
      if (!raw || hidden.has(r)) continue
      const lead = firstNonEmpty(raw)
      const labelColumn = lead && isTextLabel(lead.cell) ? lead.index : null
      afterRows.push({
        label: labelColumn === null ? '' : clip(cellText(lead!.cell).trim()).slice(0, 80),
        cells: columns.map((column) =>
          column.source === null || column.source === labelColumn ? '' : toCell(raw[column.source] ?? null, column),
        ),
      })
    }
  }

  return { rows, afterRows, hiddenSkipped, errorCells, uncachedCells, clippedCells }
}

/** Эхлэх/дуусах огноог эхний огнооны баганын эхний ба сүүлийн мөрөөс санал болгоно. */
export function suggestPeriod(rows: string[][], columns: CellSpec[]) {
  const dateIndex = columns.findIndex((c) => c.format === 'date' && c.source !== null)
  if (dateIndex === -1 || rows.length === 0) return { start: '', end: '' }
  // Буруу тааруулсан баганаас (жишээ нь гүйлгээний утга) огноо биш текст санал болгохгүй.
  const values = rows.map((row) => (row[dateIndex] ?? '').trim()).filter((v) => DATE_LIKE.test(v))
  const clip40 = (v: string | undefined) => Array.from(v ?? '').slice(0, 40).join('')
  return { start: clip40(values[0]), end: clip40(values[values.length - 1]) }
}

export const payloadBytes = (payload: unknown) => new TextEncoder().encode(JSON.stringify(payload)).length
