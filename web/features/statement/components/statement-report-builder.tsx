'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, FileDown, FileSpreadsheet, ImageUp, Loader2, Plus, Upload, X } from 'lucide-react'
import { toast } from 'sonner'
import { useStatementLogo, useStatementLogoMutations, useStatementReportPdf } from '@/hooks/useStatement'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import type { StatementReportPayload } from '@/lib/api/statement.api'
import { cn } from '@/lib/utils'
import { StatementColumnMapper } from './statement-column-mapper'
import {
  HeaderDesignBand,
  HeaderDesignToolbar,
  VERIFICATION_KEY,
  VerificationBlock,
  type DesignerSelection,
  type HeaderDesignContent,
} from './statement-header-designer'
import { StatementPreview } from './statement-preview'
import {
  VERIFICATION_LIMITS,
  addTextElement,
  adaptHeaderDesign,
  createMeasure,
  defaultVerificationText,
  kindOf,
  resolveHeaderDesign,
  restoreHeaderDesign,
  sameHeaderLayout,
  serializeHeaderDesign,
  toHeaderLayout,
  toVerificationPayload,
  updateBox,
  type ElementKey,
  type HeaderDesign,
  type SavedHeaderDesign,
} from '../lib/statement-header-layout'
import { SvgLogoError, isSvgFile, rasterizeSvgLogo } from '../lib/statement-logo-svg'
import {
  CELL_FORMATS,
  DATE_PATTERNS,
  DEFAULT_COLUMN_TEMPLATE,
  DEFAULT_HEADER_LABELS,
  STATEMENT_LIMITS,
  autoMapColumns,
  buildStatementRows,
  columnsFromHeaders,
  detectSheetLayout,
  formatManualValue,
  newColumnId,
  parseStatementWorkbook,
  payloadBytes,
  suggestPeriod,
  trailingRows,
  type CellFormat,
  type CellSpec,
  type ColumnAlign,
  type DatePattern,
  type Orientation,
  type ParsedSheet,
  type SheetLayout,
  type StatementColumnConfig,
} from '../lib/statement-xlsx'

const TEMPLATE_KEY = 'teso.finance.statementReport.template.v2'
/** v1-ийн баганын өргөн жишиг загвараас өмнөх хэмжээтэй — баганаас бусдыг нь шилжүүлнэ. */
const LEGACY_TEMPLATE_KEY = 'teso.finance.statementReport.template.v1'
const MAX_FILE_BYTES = 15 * 1024 * 1024
const NONE = 'none'
const DEFAULT_TITLE = 'Дансны дэлгэрэнгүй хуулга'
const DEFAULT_OPENING_LABEL = 'Эхний үлдэгдэл'

type HeaderField = { id: string; label: string; value: string }
type Workbook = { name: string; sheets: ParsedSheet[] }
type TemplateColumn = Omit<StatementColumnConfig, 'id'>
type SavedTemplate = {
  title: string
  headerLabels: string[]
  columns: TemplateColumn[]
  datePattern: DatePattern
  orientation: Orientation
  openingLabel: string
  logoText: string
  /** QR-ийн хажуугийн тайлбар — байрлалаас тусдаа агуулга (null бол анхдагч). */
  verificationText: string | null
  /** Толгойн дизайнерын байрлал; шалгалтыг restoreHeaderDesign хийнэ. */
  headerDesign?: SavedHeaderDesign | unknown
}

const ALIGN_VALUES: ColumnAlign[] = ['left', 'center', 'right']
const FORMAT_VALUES = CELL_FORMATS.map((f) => f.value)

const toFields = (labels: string[]): HeaderField[] => labels.map((label) => ({ id: newColumnId(), label, value: '' }))

/** localStorage-ийн утга гараар засагдсан ч байж болох тул хэлбэрийг нь шалгана. */
function readTemplate(): SavedTemplate | null {
  try {
    const current = window.localStorage.getItem(TEMPLATE_KEY)
    const raw = current ?? window.localStorage.getItem(LEGACY_TEMPLATE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<SavedTemplate>
    if (!current) delete parsed.columns
    const columns = Array.isArray(parsed.columns)
      ? parsed.columns
          .filter(
            (c): c is TemplateColumn =>
              typeof c?.label === 'string' &&
              FORMAT_VALUES.includes(c.format) &&
              ALIGN_VALUES.includes(c.align) &&
              typeof c.width === 'number' &&
              Number.isFinite(c.width) &&
              (c.source === null || (Number.isInteger(c.source) && c.source >= 0)),
          )
          .slice(0, STATEMENT_LIMITS.columns)
      : []
    return {
      title: typeof parsed.title === 'string' ? parsed.title : DEFAULT_TITLE,
      headerLabels: Array.isArray(parsed.headerLabels)
        ? parsed.headerLabels.filter((l): l is string => typeof l === 'string').slice(0, STATEMENT_LIMITS.headerFields)
        : DEFAULT_HEADER_LABELS,
      columns,
      datePattern: DATE_PATTERNS.includes(parsed.datePattern as DatePattern) ? (parsed.datePattern as DatePattern) : 'MM/DD/YYYY',
      orientation: parsed.orientation === 'landscape' ? 'landscape' : 'portrait',
      openingLabel: typeof parsed.openingLabel === 'string' ? parsed.openingLabel : DEFAULT_OPENING_LABEL,
      logoText: typeof parsed.logoText === 'string' ? parsed.logoText : '',
      verificationText:
        typeof parsed.verificationText === 'string' ? parsed.verificationText.slice(0, VERIFICATION_LIMITS.textChars) : null,
      headerDesign: parsed.headerDesign,
    }
  } catch {
    return null
  }
}

function writeTemplate(template: SavedTemplate) {
  try {
    window.localStorage.setItem(TEMPLATE_KEY, JSON.stringify(template))
  } catch {
    // Хувийн цонх / хадгалах сан хаалттай үед загвар хадгалахгүй л болно.
  }
}

const defaultOpeningColumn = (columns: StatementColumnConfig[]) =>
  (
    columns.find((c) => c.label.toLowerCase().includes('үлдэгдэл')) ??
    [...columns].reverse().find((c) => c.format === 'number') ??
    columns[columns.length - 1]
  )?.id ?? null

const stampNow = () => {
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return {
    label: `${now.getFullYear()}/${pad(now.getMonth() + 1)}/${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`,
    compact: `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`,
  }
}

const downloadBlob = (blob: Blob, fileName: string) => {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  // Safari зарим үед click-ийн дараа шууд revoke хийвэл татахгүй.
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function NoticeList({ tone, items }: { tone: 'warning' | 'danger'; items: string[] }) {
  if (items.length === 0) return null
  return (
    <div
      role={tone === 'danger' ? 'alert' : 'status'}
      // Апп `.dark` класс ашигладаг тул Tailwind-ийн `dark:` (OS-ийн тохиргоо) биш токен хэрэглэнэ.
      className={cn(
        'flex gap-2 rounded-lg border px-3 py-2.5 text-[13px]',
        tone === 'danger'
          ? 'border-[var(--color-danger)] bg-[var(--color-danger-light)] text-[var(--color-danger)]'
          : 'border-[var(--color-warning)] bg-[var(--color-warning-light)] text-[var(--color-text-primary)]',
      )}
    >
      <AlertTriangle className={cn('mt-0.5 h-4 w-4 shrink-0', tone === 'warning' && 'text-[var(--color-warning)]')} />
      <ul className="space-y-0.5">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  )
}

export function StatementReportBuilder() {
  const pdf = useStatementReportPdf()
  const logoQuery = useStatementLogo()
  const logo = logoQuery.data
  const logoMutations = useStatementLogoMutations()
  const logoInput = useRef<HTMLInputElement>(null)
  const [confirmLogoRemove, setConfirmLogoRemove] = useState(false)
  const [convertingLogo, setConvertingLogo] = useState(false)

  const [workbook, setWorkbook] = useState<Workbook | null>(null)
  const [sheetIndex, setSheetIndex] = useState(0)
  const [layout, setLayout] = useState<SheetLayout | null>(null)
  const [columns, setColumns] = useState<StatementColumnConfig[]>([])
  const [includeSummary, setIncludeSummary] = useState(true)
  const [datePattern, setDatePattern] = useState<DatePattern>('MM/DD/YYYY')
  const [title, setTitle] = useState(DEFAULT_TITLE)
  const [headerFields, setHeaderFields] = useState<HeaderField[]>(() => toFields(DEFAULT_HEADER_LABELS))
  // null — хэрэглэгч засаагүй, өгөгдлөөс санал болгосон утгыг (огнооны формат/мужтай хамт шинэчлэгдэнэ) ашиглана.
  const [periodStartOverride, setPeriodStartOverride] = useState<string | null>(null)
  const [periodEndOverride, setPeriodEndOverride] = useState<string | null>(null)
  const [includeHidden, setIncludeHidden] = useState(false)
  const [orientation, setOrientation] = useState<Orientation>('portrait')
  const [openingLabel, setOpeningLabel] = useState(DEFAULT_OPENING_LABEL)
  const [logoText, setLogoText] = useState('')
  const [openingValue, setOpeningValue] = useState('')
  const [openingColumnId, setOpeningColumnId] = useState<string | null>(null)
  // null — хэрэглэгч толгойг чирээгүй; анхдагч байрлал контенттой (гарчиг, талбар) хамт шинэчлэгдэнэ.
  const [headerDesign, setHeaderDesign] = useState<HeaderDesign | null>(null)
  // Тайлбар нь гарчиг шиг агуулга — засахад толгой гар байрлалд шилжихгүй, "Анхны байрлал" устгахгүй.
  const [verificationText, setVerificationText] = useState(defaultVerificationText)
  const [selectedHeaderKey, setSelectedHeaderKey] = useState<DesignerSelection | null>(null)
  const measure = useMemo(() => createMeasure(), [])
  const [parsing, setParsing] = useState(false)
  const [dragging, setDragging] = useState(false)
  const savedColumns = useRef<TemplateColumn[] | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  // SSR-тэй таарахын тулд хадгалсан загварыг mount болсны дараа уншина.
  useEffect(() => {
    const saved = readTemplate()
    if (!saved) return
    setTitle(saved.title)
    const fields = toFields(saved.headerLabels)
    setHeaderFields(fields)
    const restored = restoreHeaderDesign(
      saved.headerDesign,
      fields.map((f) => f.id),
    )
    setHeaderDesign(restored)
    // Өмнөх хувилбарын загвар тайлбарыг байрлалын дотор хадгалсан байж болно.
    const text = saved.verificationText ?? restored?.verification.text
    if (text !== undefined) setVerificationText(text)
    setDatePattern(saved.datePattern)
    setOrientation(saved.orientation)
    setOpeningLabel(saved.openingLabel)
    setLogoText(saved.logoText)
    savedColumns.current = saved.columns.length > 0 ? saved.columns : null
  }, [])

  const sheet = workbook?.sheets[sheetIndex] ?? null

  const columnsFor = (target: ParsedSheet, detected: SheetLayout): StatementColumnConfig[] => {
    const saved = savedColumns.current
    if (saved && saved.every((c) => c.source === null || c.source < target.colCount)) {
      return saved.map((c) => ({ ...c, id: newColumnId() }))
    }
    if (saved) return autoMapColumns(saved, target, detected)
    const mapped = autoMapColumns(DEFAULT_COLUMN_TEMPLATE, target, detected)
    // Толгойтой дурын файлд жишиг хуулгын нэрс бараг таарахгүй — Excel-ийн баганыг шууд ашиглана.
    const matched = mapped.filter((c) => c.source !== null).length
    if (detected.headerRow !== null && matched < Math.ceil(mapped.length / 2)) return columnsFromHeaders(target, detected)
    return mapped
  }

  /** `current` өгвөл хэрэглэгчийн нэр/формат/өргөнийг хадгалж зөвхөн эх баганыг шинэ хуудсанд дахин тааруулна. */
  const applySheet = (target: ParsedSheet, index: number, current: StatementColumnConfig[] | null) => {
    const detected = detectSheetLayout(target)
    let nextColumns: StatementColumnConfig[]
    if (current && current.length > 0) {
      const remapped = autoMapColumns(
        current.map(({ id: _id, source: _source, ...rest }) => rest),
        target,
        detected,
      )
      nextColumns = current.map((c, i) => ({ ...c, source: remapped[i]?.source ?? null }))
    } else {
      nextColumns = columnsFor(target, detected)
      setOpeningColumnId(defaultOpeningColumn(nextColumns))
    }
    setSheetIndex(index)
    setLayout(detected)
    setColumns(nextColumns)
    setPeriodStartOverride(null)
    setPeriodEndOverride(null)
  }

  const loadFile = async (file: File) => {
    if (!/\.(xlsx|xlsm|xls)$/i.test(file.name)) {
      toast.error('Зөвхөн Excel (.xlsx, .xls) файл оруулна уу')
      return
    }
    if (file.size > MAX_FILE_BYTES) {
      toast.error('Файлын хэмжээ 15MB-аас ихгүй байх ёстой')
      return
    }
    setParsing(true)
    try {
      const sheets = parseStatementWorkbook(await file.arrayBuffer())
      // Эхний хоосон хуудсыг (жишээ нь "Sheet1") алгасна.
      const index = sheets.findIndex((s) => detectSheetLayout(s).dataEnd >= 0)
      if (index === -1) {
        toast.error('Файлд өгөгдөл олдсонгүй')
        return
      }
      setWorkbook({ name: file.name, sheets })
      setIncludeHidden(false)
      applySheet(sheets[index]!, index, null)
    } catch {
      toast.error('Excel файлыг уншиж чадсангүй. Файл эвдэрсэн эсвэл нууц үгтэй байж магадгүй.')
    } finally {
      setParsing(false)
      if (fileInput.current) fileInput.current.value = ''
    }
  }

  // Нэр/өргөн/байрлал засахад 10,000 мөрийг дахин форматлахгүйн тулд зөвхөн нүдний текстэд нөлөөлөх хэсгээр түлхүүрлэнэ.
  const specKey = JSON.stringify(columns.map((c) => [c.source, c.format]))
  const specs = useMemo<CellSpec[]>(
    () => (JSON.parse(specKey) as Array<[number | null, CellFormat]>).map(([source, format]) => ({ source, format })),
    [specKey],
  )

  const built = useMemo(
    () =>
      sheet && layout ? buildStatementRows(sheet, layout, specs, { datePattern, includeSummary, includeHidden }) : null,
    [sheet, layout, specs, datePattern, includeSummary, includeHidden],
  )

  const suggestedPeriod = useMemo(() => (built ? suggestPeriod(built.rows, specs) : { start: '', end: '' }), [built, specs])
  const periodStart = periodStartOverride ?? suggestedPeriod.start
  const periodEnd = periodEndOverride ?? suggestedPeriod.end
  const openingColumn = columns.find((c) => c.id === openingColumnId) ?? null
  const hiddenInRange =
    sheet && layout
      ? sheet.hiddenRows.filter((r) => (r >= layout.dataStart && r <= layout.dataEnd) || layout.summaryRows.includes(r)).length
      : 0

  const logoLines = useMemo(
    () =>
      logoText
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean),
    [logoText],
  )

  // Payload-ийн headerFields-тэй ижил шүүлт — дизайнерын `fieldIndex` үүнээс тооцогдоно.
  const visibleFields = useMemo(
    () =>
      headerFields
        .map((f) => ({ id: f.id, label: f.label.trim(), value: f.value.trim() }))
        .filter((f) => f.label || f.value),
    [headerFields],
  )

  const resolvedDesign = useMemo(() => {
    const design = resolveHeaderDesign(
      headerDesign,
      { title, fields: visibleFields, logoLines, orientation, logo: logo ? { width: logo.width, height: logo.height } : null },
      measure,
    )
    return { ...design, verification: { ...design.verification, text: verificationText } }
  }, [headerDesign, title, visibleFields, logoLines, orientation, measure, logo, verificationText])

  /** Дизайнераас ирсэн өөрчлөлт: тайлбар нь тусдаа, бусад нь байрлал (гар байрлалд шилжинэ). */
  const changeHeaderDesign = (next: HeaderDesign) => {
    if (next.verification.text !== verificationText) setVerificationText(next.verification.text)
    if (!sameHeaderLayout(next, resolvedDesign)) setHeaderDesign(next)
  }

  const payload = useMemo<StatementReportPayload | null>(() => {
    if (!built || !workbook) return null
    const openingText = openingColumn ? formatManualValue(openingValue, openingColumn.format) : ''
    return {
      title: title.trim(),
      headerFields: visibleFields.map(({ label, value }) => ({ label, value })),
      logoLines,
      periodStart: periodStart.trim(),
      periodEnd: periodEnd.trim(),
      orientation,
      columns: columns.map((c) => ({ label: c.label.trim(), align: c.align, width: c.width })),
      rows: built.rows,
      beforeRows: openingText
        ? [{ label: openingLabel.trim() || DEFAULT_OPENING_LABEL, cells: columns.map((c) => (c.id === openingColumn?.id ? openingText : '')) }]
        : [],
      afterRows: built.afterRows,
      sourceFileName: Array.from(workbook.name).slice(0, 200).join(''),
      headerLayout: toHeaderLayout(
        resolvedDesign,
        visibleFields.map((f) => f.id),
      ),
      verification: toVerificationPayload(resolvedDesign.verification, orientation),
      logoSha256: logo?.sha256 ?? null,
    }
  }, [built, workbook, columns, openingColumn, openingValue, openingLabel, title, visibleFields, logoLines, periodStart, periodEnd, orientation, resolvedDesign, logo])

  const bytes = useMemo(() => (payload ? payloadBytes(payload) : 0), [payload])

  const blocking: string[] = []
  if (payload) {
    if (!payload.title) blocking.push('Тайлангийн гарчиг оруулна уу.')
    if (columns.length === 0) blocking.push('Дор хаяж нэг багана нэмнэ үү.')
    if (columns.some((c) => !Number.isFinite(c.width) || c.width < 0.3 || c.width > 20)) {
      blocking.push('Баганын өргөн 0.3–20 хооронд байх ёстой.')
    }
    if (layout && layout.dataStart > layout.dataEnd) blocking.push('Эхлэх мөр дуусах мөрөөс их байна.')
    // Лого ачаалагдаагүй үед урьдчилан харагдац "TESO" бичиглэлээр байрлуулж, PDF нь зургийг тамгална.
    if (logoQuery.isLoading) blocking.push('Байгууллагын логог ачаалж байна…')
    else if (logoQuery.isError) blocking.push('Байгууллагын логог ачаалж чадсангүй — "Тайлангийн толгой" хэсгээс дахин оролдоно уу.')
    if (Array.from(payload.periodStart).length > 40 || Array.from(payload.periodEnd).length > 40) {
      blocking.push('Эхлэх/дуусах огноо 40 тэмдэгтээс ихгүй байх ёстой.')
    }
    if (payload.logoLines.length > STATEMENT_LIMITS.logoLines) {
      blocking.push(`Логоны доорх мэдээлэл ${STATEMENT_LIMITS.logoLines} мөрөөс ихгүй байх ёстой.`)
    }
    if (payload.logoLines.some((line) => Array.from(line).length > STATEMENT_LIMITS.logoLineLength)) {
      blocking.push(`Логоны доорх мөр бүр ${STATEMENT_LIMITS.logoLineLength} тэмдэгтээс ихгүй байх ёстой.`)
    }
    if (payload.rows.length > STATEMENT_LIMITS.rows) {
      blocking.push(`Мөрийн тоо ${STATEMENT_LIMITS.rows.toLocaleString('en-US')}-аас хэтэрсэн (${payload.rows.length.toLocaleString('en-US')}). Файлыг хувааж оруулна уу.`)
    } else if (bytes > STATEMENT_LIMITS.payloadBytes) {
      blocking.push('Өгөгдөл хэт их байна (2MB). Мөр эсвэл баганын тоог багасгана уу.')
    }
  }

  const warnings: string[] = []
  if (built) {
    if (built.errorCells > 0) {
      warnings.push(
        `${built.errorCells.toLocaleString('en-US')} нүдэнд томьёоны алдаа (#REF! гэх мэт) байна — PDF-д яг тэр хэвээр гарна. Excel файлдаа засаад дахин оруулбал зөв утга харагдана.`,
      )
    }
    if (built.uncachedCells > 0) {
      warnings.push(
        `${built.uncachedCells.toLocaleString('en-US')} нүдний томьёоны утга файлд хадгалагдаагүй тул хоосон гарна. Файлыг Excel-ээр нээж хадгалаад дахин оруулна уу.`,
      )
    }
    if (built.clippedCells > 0) {
      warnings.push(`${built.clippedCells} нүдний утга ${STATEMENT_LIMITS.cellLength} тэмдэгтээс урт тул тайрагдсан.`)
    }
    const unmapped = columns.filter((c) => c.source === null).length
    if (unmapped > 0) warnings.push(`${unmapped} багана Excel-ийн баганатай тааруулаагүй тул хоосон гарна.`)
    if (openingValue.trim() && !openingColumn) {
      warnings.push('Эхний үлдэгдлийн багана сонгоогүй тул PDF-д орохгүй.')
    }
    if (built.hiddenSkipped > 0) {
      warnings.push(`Excel-д нуусан ${built.hiddenSkipped.toLocaleString('en-US')} мөрийг PDF-д оруулаагүй.`)
    }
  }

  // Нэвтрэлтгүй апп — footer-т хэрэглэгчийн нэр гарахгүй (API-ийн provenanceText-тэй ижил).
  const footerPreview = `Энэхүү тайланг TESO ITAM системд «${workbook?.name ?? ''}» файлаас ${stampNow().label}-д үүсгэв.`

  const generate = () => {
    if (!payload || blocking.length > 0) return
    pdf.mutate(payload, {
      onSuccess: (blob) => {
        const safeTitle = payload.title.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'statement'
        downloadBlob(blob, `${safeTitle}-${stampNow().compact}.pdf`)
        writeTemplate({
          title: payload.title,
          headerLabels: headerFields.map((f) => f.label),
          columns: columns.map(({ id: _id, ...rest }) => rest),
          datePattern,
          orientation,
          openingLabel,
          logoText,
          verificationText: verificationText === defaultVerificationText() ? null : verificationText,
          // Хэрэглэгч чирээгүй бол хадгалахгүй — дараагийн удаа анхдагч байрлал агуулгатай хамт дахин өрөгдөнө.
          headerDesign: headerDesign
            ? serializeHeaderDesign(
                resolvedDesign,
                headerFields.map((f) => f.id),
              )
            : null,
        })
        savedColumns.current = columns.map(({ id: _id, ...rest }) => rest)
        toast.success('PDF файл бэлэн боллоо')
      },
    })
  }

  const updateLayout = (patch: Partial<Pick<SheetLayout, 'headerRow' | 'dataStart' | 'dataEnd'>>) => {
    if (!sheet || !layout) return
    const last = Math.max(0, sheet.rows.length - 1)
    const next = { ...layout, ...patch }
    next.dataStart = Math.min(Math.max(0, next.dataStart), last)
    next.dataEnd = Math.min(Math.max(0, next.dataEnd), last)
    if (patch.headerRow !== undefined && next.headerRow !== null && next.dataStart <= next.headerRow) {
      next.dataStart = Math.min(next.headerRow + 1, last)
    }
    next.summaryRows = trailingRows(sheet, next.dataEnd)
    setLayout(next)
  }

  const resetColumns = () => {
    if (!sheet || !layout) return
    savedColumns.current = null
    const next = autoMapColumns(DEFAULT_COLUMN_TEMPLATE, sheet, layout)
    setColumns(next)
    setOpeningColumnId(defaultOpeningColumn(next))
  }

  const addColumn = () =>
    setColumns((prev) =>
      prev.length >= STATEMENT_LIMITS.columns
        ? prev
        : [...prev, { id: newColumnId(), label: 'Шинэ багана', source: null, format: 'text', align: 'left', width: 1 }],
    )

  const clearFile = () => {
    setWorkbook(null)
    setLayout(null)
    setColumns([])
    setOpeningValue('')
  }

  const designContent: HeaderDesignContent = {
    title,
    fields: visibleFields,
    logoLines,
    periodStart,
    periodEnd,
    printedDate: stampNow().label.slice(0, 10),
  }

  /** SVG-г браузерт PNG болгож илгээнэ — сервер PNG-г шалгаж хадгална. */
  const pickLogo = async (file: File | undefined) => {
    if (!file) return
    if (file.size > 2 * 1024 * 1024) {
      toast.error('Логоны файл 2MB-аас ихгүй байх ёстой')
      return
    }
    if (isSvgFile(file)) {
      setConvertingLogo(true)
      try {
        logoMutations.upload.mutate(await rasterizeSvgLogo(file))
      } catch (error) {
        toast.error(error instanceof SvgLogoError ? error.message : 'SVG-г хөрвүүлж чадсангүй — PNG болгож оруулна уу')
      } finally {
        setConvertingLogo(false)
      }
      return
    }
    if (file.type !== 'image/png' && !/\.png$/i.test(file.name)) {
      toast.error('Зөвхөн PNG эсвэл SVG зураг оруулна уу')
      return
    }
    logoMutations.upload.mutate(file)
  }
  const logoBusy = convertingLogo || logoMutations.upload.isPending

  const changeOrientation = (next: Orientation) => {
    if (headerDesign) setHeaderDesign(adaptHeaderDesign(headerDesign, orientation, next))
    setOrientation(next)
  }

  /** Талбар → толгойн талбарыг хасна, текст → устгана, бусад тогтмол элемент ба QR → нууна. */
  const removeHeaderElement = (key: DesignerSelection) => {
    if (key === VERIFICATION_KEY) {
      setHeaderDesign({ ...resolvedDesign, verification: { ...resolvedDesign.verification, hidden: true } })
      setSelectedHeaderKey(null)
      return
    }
    const kind = kindOf(key)
    const id = key.slice(key.indexOf(':') + 1)
    if (kind === 'field') {
      setHeaderDesign(resolvedDesign)
      setHeaderFields((prev) => prev.filter((f) => f.id !== id))
    } else if (kind === 'text') {
      setHeaderDesign({ ...resolvedDesign, texts: resolvedDesign.texts.filter((t) => t.id !== id) })
    } else {
      setHeaderDesign(updateBox(resolvedDesign, key, { hidden: true }))
    }
    setSelectedHeaderKey(null)
  }

  const addHeaderText = () => {
    const id = newColumnId()
    setHeaderDesign(addTextElement(resolvedDesign, id, orientation))
    setSelectedHeaderKey(`text:${id}`)
  }

  const rowCount = sheet?.rows.length ?? 0
  const canSubmit = Boolean(payload) && blocking.length === 0 && !pdf.isPending

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[17px] font-semibold text-text-primary">Хуулгын тайлан</h1>
          <p className="mt-0.5 text-[13px] text-text-secondary">
            Excel файлын баганыг PDF хуулгын баганад тааруулж, TESO логотой тайлан үүсгэнэ. Утгууд файлд байгаагаараа гарна.
          </p>
        </div>
        {workbook ? (
          <div className="flex items-center gap-2">
            <span className="flex h-9 max-w-[260px] items-center gap-2 rounded-lg border border-border bg-surface px-3 text-[13px] text-text-primary">
              <FileSpreadsheet className="h-4 w-4 shrink-0 text-emerald-600" />
              <span className="truncate">{workbook.name}</span>
              <button type="button" aria-label="Файлыг хасах" onClick={clearFile} className="text-text-secondary hover:text-text-primary">
                <X className="h-3.5 w-3.5" />
              </button>
            </span>
            <Button onClick={generate} disabled={!canSubmit}>
              {pdf.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileDown className="h-4 w-4" />}
              PDF татах
            </Button>
          </div>
        ) : null}
      </header>

      <input
        ref={fileInput}
        type="file"
        accept=".xlsx,.xlsm,.xls"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) void loadFile(file)
        }}
      />

      {!workbook ? (
        <button
          type="button"
          onClick={() => fileInput.current?.click()}
          onDragOver={(e) => {
            e.preventDefault()
            setDragging(true)
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault()
            setDragging(false)
            const file = e.dataTransfer.files?.[0]
            if (file) void loadFile(file)
          }}
          className={cn(
            'flex w-full flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed px-6 py-16 text-center transition-colors',
            dragging ? 'border-accent bg-accent-light' : 'border-border bg-surface hover:border-accent hover:bg-surface-raised',
          )}
        >
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-accent-light text-accent">
            {parsing ? <Loader2 className="h-6 w-6 animate-spin" /> : <Upload className="h-6 w-6" />}
          </span>
          <span className="text-[15px] font-semibold text-text-primary">
            {parsing ? 'Файлыг уншиж байна…' : 'Excel файл сонгох эсвэл энд чирж оруулах'}
          </span>
          <span className="max-w-md text-[13px] text-text-secondary">
            .xlsx эсвэл .xls, 15MB хүртэл. Файл таны браузерт уншигдана — серверт зөвхөн PDF үүсгэхэд хэрэгтэй утгууд илгээгдэнэ.
          </span>
        </button>
      ) : null}

      {workbook && sheet && layout ? (
        <>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Excel өгөгдөл</CardTitle>
                <CardDescription>
                  {rowCount.toLocaleString('en-US')} мөр, {sheet.colCount} багана. Мөрийн дугаар Excel-тэй ижил.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <Label>Хуудас</Label>
                    <Select
                      value={String(sheetIndex)}
                      onValueChange={(value) => applySheet(workbook.sheets[Number(value)]!, Number(value), columns)}
                    >
                      <SelectTrigger aria-label="Хуудас">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {workbook.sheets.map((s, i) => (
                          <SelectItem key={s.name} value={String(i)}>
                            {s.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Толгой мөр</Label>
                    <Select
                      value={layout.headerRow === null ? NONE : String(layout.headerRow)}
                      onValueChange={(value) => updateLayout({ headerRow: value === NONE ? null : Number(value) })}
                    >
                      <SelectTrigger aria-label="Толгой мөр">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NONE}>Байхгүй</SelectItem>
                        {Array.from({ length: Math.min(20, rowCount) }, (_, r) => (
                          <SelectItem key={r} value={String(r)}>
                            {r + 1}-р мөр
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label htmlFor="statement-data-start">Өгөгдлийн эхлэх мөр</Label>
                    <Input
                      id="statement-data-start"
                      type="number"
                      min={1}
                      max={rowCount}
                      value={layout.dataStart + 1}
                      onChange={(e) => Number.isFinite(e.target.valueAsNumber) && updateLayout({ dataStart: e.target.valueAsNumber - 1 })}
                    />
                  </div>
                  <div>
                    <Label htmlFor="statement-data-end">Өгөгдлийн дуусах мөр</Label>
                    <Input
                      id="statement-data-end"
                      type="number"
                      min={1}
                      max={rowCount}
                      value={layout.dataEnd + 1}
                      onChange={(e) => Number.isFinite(e.target.valueAsNumber) && updateLayout({ dataEnd: e.target.valueAsNumber - 1 })}
                    />
                  </div>
                </div>
                <div className="flex items-start justify-between gap-3 rounded-lg border border-border px-3 py-2.5">
                  <div className="text-[13px]">
                    <p className="font-medium text-text-primary">Хураангуй мөрийг төгсгөлд харуулах</p>
                    <p className="text-text-secondary">
                      {layout.summaryRows.length > 0
                        ? `Дуусах мөрийн дараах ${layout.summaryRows.map((r) => r + 1).join(', ')}-р мөр (жишээ нь "Нийт дүн", "Эцсийн үлдэгдэл").`
                        : 'Дуусах мөрийн дараа хураангуй мөр алга.'}
                    </p>
                  </div>
                  <Switch
                    aria-label="Хураангуй мөрийг төгсгөлд харуулах"
                    checked={includeSummary && layout.summaryRows.length > 0}
                    onCheckedChange={setIncludeSummary}
                  />
                </div>
                {hiddenInRange > 0 ? (
                  <div className="flex items-start justify-between gap-3 rounded-lg border border-border px-3 py-2.5">
                    <div className="text-[13px]">
                      <p className="font-medium text-text-primary">Excel-д нуусан мөрийг оруулах</p>
                      <p className="text-text-secondary">
                        {hiddenInRange.toLocaleString('en-US')} мөр нуугдсан эсвэл шүүлтүүрээр далдлагдсан байна. Анхдагчаар PDF-д орохгүй.
                      </p>
                    </div>
                    <Switch aria-label="Excel-д нуусан мөрийг оруулах" checked={includeHidden} onCheckedChange={setIncludeHidden} />
                  </div>
                ) : null}
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <Label>Огнооны формат</Label>
                    <Select value={datePattern} onValueChange={(value) => setDatePattern(value as DatePattern)}>
                      <SelectTrigger aria-label="Огнооны формат">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {DATE_PATTERNS.map((pattern) => (
                          <SelectItem key={pattern} value={pattern}>
                            {pattern}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Хуудасны чиглэл</Label>
                    <Select value={orientation} onValueChange={(value) => changeOrientation(value as Orientation)}>
                      <SelectTrigger aria-label="Хуудасны чиглэл">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="portrait">Босоо (A4)</SelectItem>
                        <SelectItem value="landscape">Хэвтээ (A4)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Тайлангийн толгой</CardTitle>
                <CardDescription>
                  Гарчиг, хугацаа, толгойн талбаруудын утга. Байрлалыг доорх урьдчилан харагдацад чирж өөрчилнө.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label>Байгууллагын лого (PNG, SVG)</Label>
                  <div className="flex flex-wrap items-center gap-3">
                    <div
                      className="flex h-14 w-36 items-center justify-center rounded-md border border-border"
                      style={{ background: 'repeating-conic-gradient(#f1f5f9 0% 25%, #ffffff 0% 50%) 0 0 / 12px 12px' }}
                    >
                      {logoQuery.isLoading ? (
                        <Loader2 className="h-5 w-5 animate-spin text-text-secondary" aria-label="Лого ачаалж байна" />
                      ) : logo ? (
                        // eslint-disable-next-line @next/next/no-img-element -- data URL
                        <img src={logo.src} alt="Байгууллагын лого" className="max-h-12 max-w-[136px] object-contain" />
                      ) : logoQuery.isError ? (
                        <AlertTriangle className="h-5 w-5 text-[var(--color-danger)]" aria-label="Лого ачаалж чадсангүй" />
                      ) : (
                        <span className="text-[18px] font-bold text-[#0b2e59]">TESO</span>
                      )}
                    </div>
                    <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                      <div className="flex flex-wrap gap-2">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={logoBusy}
                          onClick={() => logoInput.current?.click()}
                        >
                          {logoBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ImageUp className="h-3.5 w-3.5" />}
                          {logo ? 'Лого солих' : 'Лого оруулах'}
                        </Button>
                        {logo ? (
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            disabled={logoMutations.remove.isPending}
                            onClick={() => setConfirmLogoRemove(true)}
                            className="text-[var(--color-danger)]"
                          >
                            Устгах
                          </Button>
                        ) : null}
                      </div>
                      {logoQuery.isError ? (
                        <p className="flex flex-wrap items-center gap-2 text-[12px] text-[var(--color-danger)]">
                          Логог ачаалж чадсангүй.
                          <button type="button" className="underline underline-offset-2" onClick={() => void logoQuery.refetch()}>
                            Дахин оролдох
                          </button>
                        </p>
                      ) : null}
                      <p className="text-[12px] text-text-secondary">
                        Бүх хуулгын тайланд хэрэглэгдэнэ. PNG эсвэл SVG, 2MB хүртэл (SVG-г 2000px PNG болгоно); оруулаагүй бол
                        &quot;TESO&quot; бичиглэл гарна. Хэмжээг урьдчилан харагдацад логоны доод булангаас чирж өөрчилнө.
                      </p>
                    </div>
                  </div>
                  <input
                    ref={logoInput}
                    type="file"
                    accept="image/png,.png,image/svg+xml,.svg"
                    className="hidden"
                    aria-label="Лого (PNG, SVG) сонгох"
                    onChange={(event) => {
                      void pickLogo(event.target.files?.[0])
                      event.target.value = ''
                    }}
                  />
                  <ConfirmDialog
                    open={confirmLogoRemove}
                    onOpenChange={setConfirmLogoRemove}
                    title="Логог устгах уу?"
                    description="Бүх хуулгын тайланд лого оронд нь &quot;TESO&quot; бичиглэл гарна."
                    confirmLabel="Устгах"
                    variant="danger"
                    onConfirm={() => {
                      logoMutations.remove.mutate()
                      setConfirmLogoRemove(false)
                    }}
                  />
                </div>
                <div>
                  <Label htmlFor="statement-title">Гарчиг</Label>
                  <Input id="statement-title" value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} />
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <Label htmlFor="statement-period-start">Эхлэх огноо</Label>
                    <Input id="statement-period-start" value={periodStart} maxLength={40} onChange={(e) => setPeriodStartOverride(e.target.value)} />
                  </div>
                  <div>
                    <Label htmlFor="statement-period-end">Дуусах огноо</Label>
                    <Input id="statement-period-end" value={periodEnd} maxLength={40} onChange={(e) => setPeriodEndOverride(e.target.value)} />
                  </div>
                </div>
                <div>
                  <Label htmlFor="statement-logo-lines">Логоны доорх мэдээлэл</Label>
                  <Textarea
                    id="statement-logo-lines"
                    rows={4}
                    value={logoText}
                    onChange={(e) => setLogoText(e.target.value)}
                    placeholder={'Байгууллагын нэр\nХаяг\nУтас: ...\nВэб: ...'}
                  />
                  <p className="mt-1 text-[12px] text-text-secondary">
                    Мөр бүрт нэг мэдээлэл, {STATEMENT_LIMITS.logoLines} мөр хүртэл. Хоосон бол зөвхөн лого харагдана.
                  </p>
                </div>
                <div className="space-y-2">
                  <Label>Толгойн талбарууд</Label>
                  {headerFields.map((field, i) => (
                    <div key={field.id} className="flex items-center gap-2">
                      <Input
                        aria-label={`${i + 1}-р талбарын нэр`}
                        placeholder="Нэр"
                        value={field.label}
                        maxLength={60}
                        onChange={(e) =>
                          setHeaderFields((prev) => prev.map((f) => (f.id === field.id ? { ...f, label: e.target.value } : f)))
                        }
                        className="w-[42%]"
                      />
                      <Input
                        aria-label={`${i + 1}-р талбарын утга`}
                        placeholder="Утга"
                        value={field.value}
                        maxLength={200}
                        onChange={(e) =>
                          setHeaderFields((prev) => prev.map((f) => (f.id === field.id ? { ...f, value: e.target.value } : f)))
                        }
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={`${i + 1}-р талбарыг устгах`}
                        onClick={() => setHeaderFields((prev) => prev.filter((f) => f.id !== field.id))}
                      >
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  ))}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={headerFields.length >= STATEMENT_LIMITS.headerFields}
                    onClick={() => setHeaderFields((prev) => [...prev, { id: newColumnId(), label: '', value: '' }])}
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Талбар нэмэх
                  </Button>
                </div>
                <div className="space-y-2">
                  <Label>Эхний үлдэгдэл (заавал биш)</Label>
                  <div className="grid gap-2 sm:grid-cols-[1fr_1fr_1fr]">
                    <Input aria-label="Мөрийн нэр" value={openingLabel} maxLength={80} onChange={(e) => setOpeningLabel(e.target.value)} />
                    <Input aria-label="Эхний үлдэгдлийн утга" placeholder="Утга" value={openingValue} maxLength={60} onChange={(e) => setOpeningValue(e.target.value)} />
                    <Select value={openingColumn?.id ?? NONE} onValueChange={(value) => setOpeningColumnId(value === NONE ? null : value)}>
                      <SelectTrigger aria-label="Эхний үлдэгдлийн багана">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NONE}>— Багана сонгох —</SelectItem>
                        {columns.map((c, i) => (
                          <SelectItem key={c.id} value={c.id}>
                            {c.label.trim() || `${i + 1}-р багана`}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Багана тааруулах</CardTitle>
              <CardDescription>PDF-ийн багана бүрт Excel-ийн аль баганыг харуулахыг сонгоно. Дарааллыг сумаар солино.</CardDescription>
            </CardHeader>
            <CardContent>
              <StatementColumnMapper
                sheet={sheet}
                layout={layout}
                columns={columns}
                onChange={setColumns}
                onAdd={addColumn}
                onReset={resetColumns}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <CardTitle>Урьдчилан харах</CardTitle>
                <CardDescription>
                  {(payload?.rows.length ?? 0).toLocaleString('en-US')} мөр · {columns.length} багана
                  {payload && payload.afterRows.length > 0 ? ` · ${payload.afterRows.length} хураангуй мөр` : ''}. Эхний 15 мөрийг
                  харуулж байна. Толгойн хэсгийн текстийг чирж байрлуулна.
                </CardDescription>
              </div>
              <Button onClick={generate} disabled={!canSubmit}>
                {pdf.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileDown className="h-4 w-4" />}
                PDF татах
              </Button>
            </CardHeader>
            <CardContent className="space-y-3">
              <NoticeList tone="danger" items={blocking} />
              <NoticeList tone="warning" items={warnings} />
              {payload ? (
                <>
                  <HeaderDesignToolbar
                    design={resolvedDesign}
                    orientation={orientation}
                    content={designContent}
                    selected={selectedHeaderKey}
                    onChange={changeHeaderDesign}
                    onAddText={addHeaderText}
                    onReset={() => {
                      // Байрлалыг л анхны болгоно — QR-ийн тайлбар тусдаа агуулга тул хэвээр үлдэнэ.
                      setHeaderDesign(null)
                      setSelectedHeaderKey(null)
                    }}
                    onRemove={removeHeaderElement}
                  />
                  <StatementPreview
                    payload={payload}
                    footer={footerPreview}
                    header={
                      <HeaderDesignBand
                        design={resolvedDesign}
                        orientation={orientation}
                        content={designContent}
                        logo={logo ?? null}
                        selected={selectedHeaderKey}
                        onSelect={setSelectedHeaderKey}
                        onChange={changeHeaderDesign}
                        onRemove={removeHeaderElement}
                      />
                    }
                    afterContent={
                      <VerificationBlock
                        design={resolvedDesign}
                        orientation={orientation}
                        selected={selectedHeaderKey}
                        onSelect={setSelectedHeaderKey}
                        onChange={changeHeaderDesign}
                      />
                    }
                  />
                </>
              ) : null}
            </CardContent>
          </Card>
        </>
      ) : null}
    </div>
  )
}
