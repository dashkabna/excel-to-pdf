import { describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'
import {
  DEFAULT_COLUMN_TEMPLATE,
  autoMapColumns,
  buildStatementRows,
  cellText,
  columnsFromHeaders,
  formatAmount,
  detectSheetLayout,
  formatCell,
  formatManualValue,
  parseStatementWorkbook,
  suggestPeriod,
  trailingRows,
  type StatementColumnConfig,
} from '@/features/statement/lib/statement-xlsx'

/** Жишиг файлтай ижил бүтэц: толгойгүй, огноо нь текст ба Excel огноо холимог, J нь #REF! томьёо. */
function sampleWorkbook(): ArrayBuffer {
  const ws: XLSX.WorkSheet = {}
  const put = (ref: string, cell: XLSX.CellObject) => {
    ws[ref] = cell
  }
  const rows: Array<Array<XLSX.CellObject | null>> = [
    [
      { t: 'n', v: 1, z: '0' },
      { t: 's', v: '10/09/2025', z: '@' },
      { t: 'n', v: 5000, z: '0' },
      { t: 'n', v: 29137708, z: '0' },
      { t: 'n', v: 100260100002, z: '0' },
      { t: 's', v: '16:04' },
      { t: 's', v: 'orlogo' },
      { t: 'n', v: 80000, z: '#,##0.00' },
      null,
      { t: 'e', v: 0x17, w: '#REF!', f: '#REF!+H1+I1' },
      { t: 's', v: '10/09/2025', z: '@' },
    ],
    [
      { t: 'n', v: 2, z: '0' },
      // 2025-10-24 — Excel serial
      { t: 'n', v: 45954, z: 'mm-dd-yy' },
      { t: 'n', v: 5031, z: '0' },
      { t: 'n', v: 29142560, z: '0' },
      null,
      // 10:01
      { t: 'n', v: 10 / 24 + 1 / 1440, z: 'h:mm' },
      { t: 's', v: 'ENKHTUR ZOLBAYAR ХААНААС:\n150000 ЗОЛБАЯР ЭНХТӨР' },
      null,
      { t: 'n', v: -50, z: '#,##0.00' },
      { t: 'e', v: 0x17, w: '#REF!', f: 'J1+H2+I2' },
      { t: 'n', v: 45954, z: 'mm-dd-yy' },
    ],
    [
      { t: 'n', v: 3, z: '0' },
      { t: 'n', v: 45955, z: 'mm-dd-yy' },
      { t: 'n', v: 5008, z: '0' },
      { t: 'n', v: 938360, z: '0' },
      null,
      { t: 's', v: '07:03' },
      { t: 's', v: 'CANVA.COM' },
      null,
      { t: 'n', v: -144414.09, z: '#,##0.00' },
      { t: 'e', v: 0x17, w: '#REF!', f: 'J2+H3+I3' },
      { t: 'n', v: 45955, z: 'mm-dd-yy' },
    ],
    [
      { t: 's', v: 'Нийт дүн' },
      null,
      null,
      null,
      null,
      null,
      null,
      { t: 'n', v: 80000, z: '#,##0.00', f: 'SUM(H1:H3)' },
      { t: 'n', v: 144464.09, z: '#,##0.00', f: 'ABS(SUM(I1:I3))' },
      null,
      null,
    ],
    [
      { t: 's', v: 'Эцсийн үлдэгдэл' },
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      { t: 'n', v: 81710892.62, z: '#,##0.00' },
      null,
    ],
  ]
  rows.forEach((row, r) =>
    row.forEach((cell, c) => {
      if (cell) put(XLSX.utils.encode_cell({ r, c }), cell)
    }),
  )
  ws['!ref'] = 'A1:K5'
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Дансны хуулга')
  const out = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
  return out
}

const columnsFor = () => {
  const [sheet] = parseStatementWorkbook(sampleWorkbook())
  const layout = detectSheetLayout(sheet!)
  return { sheet: sheet!, layout, columns: autoMapColumns(DEFAULT_COLUMN_TEMPLATE, sheet!, layout) }
}

describe('statement xlsx parsing', () => {
  it('detects a headerless sheet with trailing summary rows', () => {
    const { layout } = columnsFor()
    expect(layout).toEqual({ headerRow: null, dataStart: 0, dataEnd: 2, summaryRows: [3, 4] })
  })

  it('maps the 11 template columns to A..K by position', () => {
    const { columns } = columnsFor()
    expect(columns.map((c) => c.source)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
  })

  it('formats dates, times and amounts while keeping text and error cells as they appear in Excel', () => {
    const { sheet, layout, columns } = columnsFor()
    const built = buildStatementRows(sheet, layout, columns, { datePattern: 'MM/DD/YYYY', includeSummary: true })

    expect(built.rows).toEqual([
      ['1', '10/09/2025', '5000', '29137708', '100260100002', '16:04', 'orlogo', '80,000.00', '', '#REF!', '10/09/2025'],
      [
        '2',
        '10/24/2025',
        '5031',
        '29142560',
        '',
        '10:01',
        'ENKHTUR ZOLBAYAR ХААНААС:\n150000 ЗОЛБАЯР ЭНХТӨР',
        '',
        '-50.00',
        '#REF!',
        '10/24/2025',
      ],
      ['3', '10/25/2025', '5008', '938360', '', '07:03', 'CANVA.COM', '', '-144,414.09', '#REF!', '10/25/2025'],
    ])
    expect(built.errorCells).toBe(3)
    expect(built.afterRows).toEqual([
      { label: 'Нийт дүн', cells: ['', '', '', '', '', '', '', '80,000.00', '144,464.09', '', ''] },
      { label: 'Эцсийн үлдэгдэл', cells: ['', '', '', '', '', '', '', '', '', '81,710,892.62', ''] },
    ])
  })

  it('applies the chosen date pattern and drops summary rows when disabled', () => {
    const { sheet, layout, columns } = columnsFor()
    const built = buildStatementRows(sheet, layout, columns, { datePattern: 'YYYY-MM-DD', includeSummary: false })
    expect(built.rows[1]![1]).toBe('2025-10-24')
    expect(built.afterRows).toEqual([])
  })

  it('leaves unmapped columns empty and respects reordering', () => {
    const { sheet, layout, columns } = columnsFor()
    const custom: StatementColumnConfig[] = [
      { ...columns[6]!, label: 'Утга' },
      { ...columns[0]!, source: null },
    ]
    const built = buildStatementRows(sheet, layout, custom, { datePattern: 'MM/DD/YYYY', includeSummary: true })
    expect(built.rows[0]).toEqual(['orlogo', ''])
    expect(built.afterRows[0]).toEqual({ label: 'Нийт дүн', cells: ['', ''] })
  })

  it('suggests the period from the first and last value of the first date column', () => {
    const { sheet, layout, columns } = columnsFor()
    const built = buildStatementRows(sheet, layout, columns, { datePattern: 'MM/DD/YYYY', includeSummary: false })
    expect(suggestPeriod(built.rows, columns)).toEqual({ start: '10/09/2025', end: '10/25/2025' })
  })

  it('recomputes summary rows when the data end row moves', () => {
    const { sheet } = columnsFor()
    expect(trailingRows(sheet, 1)).toEqual([2, 3, 4])
    expect(trailingRows(sheet, 4)).toEqual([])
  })

  it('detects a header row and maps columns by header name', () => {
    const ws = XLSX.utils.aoa_to_sheet([
      ['Огноо', 'Тайлбар', 'Орлого', 'Зарлага'],
      ['2026-01-01', 'Түрээс', 1000, null],
      ['2026-01-02', 'Цалин', null, 250.5],
    ])
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Sheet1')
    const [sheet] = parseStatementWorkbook(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer)
    const layout = detectSheetLayout(sheet!)
    expect(layout.headerRow).toBe(0)
    expect(layout.dataStart).toBe(1)
    const columns = autoMapColumns(
      [
        { label: 'Орлого', format: 'number', align: 'right', width: 1 },
        { label: 'Гүйлгээний утга', format: 'text', align: 'left', width: 1 },
      ],
      sheet!,
      layout,
    )
    // "Орлого" нэрээр C-д; "Гүйлгээний утга" толгойд байхгүй тул байрлалаар таамаглахгүй, хоосон үлдэнэ.
    expect(columns.map((c) => c.source)).toEqual([2, null])
    expect(buildStatementRows(sheet!, layout, columns, { datePattern: 'MM/DD/YYYY', includeSummary: true }).rows).toEqual([
      ['1,000.00', ''],
      ['', ''],
    ])
  })

  it('prefers exact header matches and ignores very short substrings', () => {
    const [sheet] = parseStatementWorkbook(
      workbookFrom(XLSX.utils.aoa_to_sheet([
        ['Д/д', 'Огноо', 'Салбар №', 'Гүйлгээний утга', 'Орлого'],
        [1, '2026-01-01', 5000, 'Түрээс', 100],
      ])),
    )
    const layout = detectSheetLayout(sheet!)
    const columns = autoMapColumns(DEFAULT_COLUMN_TEMPLATE, sheet!, layout)
    const byLabel = Object.fromEntries(columns.map((c) => [c.label, c.source]))
    expect(byLabel['№']).toBeNull()
    expect(byLabel['Салбар №']).toBe(2)
    expect(byLabel['Гүйлгээний утга']).toBe(3)
    expect(byLabel['Орлого']).toBe(4)
  })

  it('builds one PDF column per Excel column from the header row with guessed formats', () => {
    const ws = XLSX.utils.aoa_to_sheet([
      ['Date', 'Description', 'Amount'],
      [{ t: 'n', v: 45954, z: 'yyyy-mm-dd' }, 'Rent for January', 1250.5],
      [{ t: 'n', v: 45955, z: 'yyyy-mm-dd' }, 'Salary', -300],
    ])
    const [sheet] = parseStatementWorkbook(workbookFrom(ws))
    const columns = columnsFromHeaders(sheet!, detectSheetLayout(sheet!))
    expect(columns.map(({ label, source, format, align }) => ({ label, source, format, align }))).toEqual([
      { label: 'Date', source: 0, format: 'date', align: 'center' },
      { label: 'Description', source: 1, format: 'text', align: 'left' },
      { label: 'Amount', source: 2, format: 'number', align: 'right' },
    ])
  })

  it('converts serials using the 1904 date system when the workbook uses it', () => {
    const ws: XLSX.WorkSheet = { A1: { t: 'n', v: 44492.417, z: 'yyyy-mm-dd hh:mm' }, '!ref': 'A1:A1' }
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'S')
    wb.Workbook = { WBProps: { date1904: true } }
    const [sheet] = parseStatementWorkbook(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer)
    expect(sheet!.date1904).toBe(true)
    const built = buildStatementRows(sheet!, { headerRow: null, dataStart: 0, dataEnd: 0, summaryRows: [] }, [{ source: 0, format: 'date' }], {
      datePattern: 'YYYY-MM-DD',
      includeSummary: false,
    })
    expect(built.rows).toEqual([['2025-10-24']])
  })

  it('reports formulas saved without a cached value instead of silently dropping them', () => {
    const ws: XLSX.WorkSheet = {
      A1: { t: 's', v: 'Нийт' },
      B1: { t: 'n', v: 10 },
      C1: { t: 'n', f: 'B1*2' } as XLSX.CellObject,
      '!ref': 'A1:C1',
    }
    const [sheet] = parseStatementWorkbook(workbookFrom(ws))
    const built = buildStatementRows(
      sheet!,
      { headerRow: null, dataStart: 0, dataEnd: 0, summaryRows: [] },
      [{ source: 1, format: 'number' }, { source: 2, format: 'number' }],
      { datePattern: 'MM/DD/YYYY', includeSummary: false },
    )
    expect(built.rows).toEqual([['10.00', '']])
    expect(built.uncachedCells).toBe(1)
  })

  it('skips rows hidden in Excel unless asked to include them', () => {
    const ws = XLSX.utils.aoa_to_sheet([
      [1, 'A-111', 100],
      [2, 'B-222', 999],
      [3, 'A-111', 50],
    ])
    ws['!rows'] = [{}, { hidden: true }, {}]
    const [sheet] = parseStatementWorkbook(workbookFrom(ws))
    expect(sheet!.hiddenRows).toEqual([1])
    const layout = detectSheetLayout(sheet!)
    const specs = [{ source: 1, format: 'text' as const }]
    const visible = buildStatementRows(sheet!, layout, specs, { datePattern: 'MM/DD/YYYY', includeSummary: true })
    expect(visible.rows).toEqual([['A-111'], ['A-111']])
    expect(visible.hiddenSkipped).toBe(1)
    const all = buildStatementRows(sheet!, layout, specs, { datePattern: 'MM/DD/YYYY', includeSummary: true, includeHidden: true })
    expect(all.rows).toHaveLength(3)
  })

  it('only suggests date-looking values for the period, clipped to 40 characters', () => {
    const specs = [{ source: 0, format: 'date' as const }]
    expect(suggestPeriod([['ENKHTUR ZOLBAYAR ХААНААС: 150000 ЗОЛБАЯР ЭНХТӨР'], ['2026-01-02']], specs)).toEqual({
      start: '2026-01-02',
      end: '2026-01-02',
    })
    expect(suggestPeriod([['Огноо'], ['тодорхойгүй']], specs)).toEqual({ start: '', end: '' })
  })
})

function workbookFrom(ws: XLSX.WorkSheet): ArrayBuffer {
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1')
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
}

describe('statement cell formatting', () => {
  it('never prints large integers in exponent form', () => {
    expect(cellText({ t: 'n', v: 100260100002, w: '1.0026E+11' })).toBe('100260100002')
  })

  it('keeps Excel display text for non-integer numbers in text format', () => {
    expect(formatCell({ t: 'n', v: 0.1234, w: '12.34%', z: '0.00%' }, 'text', 'MM/DD/YYYY')).toBe('12.34%')
  })

  it('normalises negative zero amounts', () => {
    expect(formatCell({ t: 'n', v: -0.001 }, 'number', 'MM/DD/YYYY')).toBe('0.00')
  })

  it('rounds half-cent amounts like Excel', () => {
    expect(formatAmount(1.005)).toBe('1.01')
    expect(formatAmount(-1234.565)).toBe('-1,234.57')
    expect(formatAmount(-0.125)).toBe('-0.13')
  })

  it('returns empty text for formulas without a cached value', () => {
    expect(formatCell({ t: 'n', v: undefined, uncached: true }, 'number', 'MM/DD/YYYY')).toBe('')
  })

  it('formats manual opening balances only for number columns', () => {
    expect(formatManualValue('10830.17', 'number')).toBe('10,830.17')
    expect(formatManualValue('1 000', 'number')).toBe('1,000.00')
    expect(formatManualValue('тодорхойгүй', 'number')).toBe('тодорхойгүй')
    expect(formatManualValue('10830.17', 'text')).toBe('10830.17')
  })
})
