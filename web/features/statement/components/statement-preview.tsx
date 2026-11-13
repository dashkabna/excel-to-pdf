'use client'

import { Fragment, type CSSProperties, type ReactNode } from 'react'
import type { StatementReportPayload } from '@/lib/api/statement.api'
import { cn } from '@/lib/utils'
import { PREVIEW_PX } from '../lib/statement-header-layout'

const PREVIEW_ROWS = 15

/**
 * PDF-ийн pt хэмжээсийг (API-ийн PDF модуль (pdf)) 880px цаасанд буулгах
 * харьцаа: 880 / 595.28pt. Хэмжээсүүд PDF-тэй ижил харьцаатай байх ёстой, эс бөгөөс
 * PDF-д багтаж байгаа тоо энд тасарч харагдана.
 */
const PX = PREVIEW_PX
const pt = (value: number) => `${(value * PX).toFixed(2)}px`

/** PDF нь энгийн фонтыг fill+stroke-оор тодруулдаг — үсгийн өргөн ижил үлдэнэ. */
const FAUX_BOLD: CSSProperties = { WebkitTextStroke: '0.04em currentColor' }

const alignClass = (align: 'left' | 'center' | 'right') =>
  align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left'

const cellStyle: CSSProperties = { padding: `${pt(0.375)} ${pt(2.2)}`, lineHeight: pt(8.2) }

function SummaryRow({
  row,
  columns,
}: {
  row: { label: string; cells: string[] }
  columns: StatementReportPayload['columns']
}) {
  const firstValue = row.cells.findIndex((cell) => cell !== '')
  const span = firstValue === -1 ? columns.length : firstValue
  if (span === 0) {
    return (
      <>
        {row.label ? (
          <tr style={FAUX_BOLD}>
            <td colSpan={columns.length} style={cellStyle}>
              {row.label}
            </td>
          </tr>
        ) : null}
        <tr style={FAUX_BOLD}>
          {columns.map((column, i) => (
            <td key={i} className={alignClass(column.align)} style={cellStyle}>
              {row.cells[i]}
            </td>
          ))}
        </tr>
      </>
    )
  }
  return (
    <tr style={FAUX_BOLD}>
      <td colSpan={span} style={cellStyle}>
        {row.label}
      </td>
      {columns.slice(span).map((column, offset) => (
        <td key={span + offset} className={alignClass(column.align)} style={cellStyle}>
          {row.cells[span + offset]}
        </td>
      ))}
    </tr>
  )
}

const Spacer = ({ colSpan, height }: { colSpan: number; height: number }) => (
  <tr aria-hidden>
    <td colSpan={colSpan} style={{ height: pt(height), padding: 0 }} />
  </tr>
)

/**
 * PDF-ийн 1-р хуудсыг HTML-ээр ойролцоолсон урьдчилсан харагдац. Цаас дуурайлгах тул
 * харанхуй горимд ч цагаан дэвсгэртэй. `header` — толгойн дизайнерын хэсэг (хуудасны
 * дээд ирмэгээс эхэлнэ); хүснэгт түүний доод ирмэгээс эхэлнэ.
 */
export function StatementPreview({
  payload,
  footer,
  header,
  afterContent,
}: {
  payload: StatementReportPayload
  footer: string
  header: ReactNode
  /** Хүснэгт/хураангуйн доор (баталгаажуулах QR). */
  afterContent?: ReactNode
}) {
  const totalWidth =
    payload.columns.reduce((sum, c) => sum + (Number.isFinite(c.width) && c.width > 0 ? c.width : 0), 0) || 1
  const visibleRows = payload.rows.slice(0, PREVIEW_ROWS)
  const hidden = payload.rows.length - visibleRows.length
  const colSpan = payload.columns.length

  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-surface-raised p-3 sm:p-5">
      <div
        className={cn(
          'mx-auto bg-white text-neutral-900 shadow-md',
          payload.orientation === 'landscape' ? 'w-[1245px]' : 'w-[880px]',
        )}
        style={{
          fontFamily: 'Arimo, Arial, Helvetica, sans-serif',
          fontSize: pt(6),
          paddingBottom: pt(12),
        }}
      >
        {header}

        <div style={{ paddingLeft: pt(20.16), paddingRight: pt(29.37) }}>
          <table className="w-full table-fixed border-collapse" style={{ lineHeight: pt(8.2) }}>
            <colgroup>
              {payload.columns.map((column, i) => (
                <col
                  key={i}
                  style={{
                    width: `${((Number.isFinite(column.width) && column.width > 0 ? column.width : 0) / totalWidth) * 100}%`,
                  }}
                />
              ))}
            </colgroup>
            <thead>
              {/* PDF-тэй адил баганын нэрийн дээр ба доор давхар зураас; зөвхөн 1-р хуудсанд. */}
              <tr className="border-y-[4px] border-double border-neutral-900">
                {payload.columns.map((column, i) => (
                  <th
                    key={i}
                    className="break-words text-center align-middle font-normal"
                    style={{ ...FAUX_BOLD, padding: `${pt(5.3)} ${pt(2.2)} ${pt(2.2)}` }}
                  >
                    {column.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {payload.beforeRows.length > 0 ? (
                <>
                  <Spacer colSpan={colSpan} height={17.3} />
                  {payload.beforeRows.map((row, i) => (
                    <SummaryRow key={`before-${i}`} row={row} columns={payload.columns} />
                  ))}
                  <Spacer colSpan={colSpan} height={4.15} />
                </>
              ) : (
                <Spacer colSpan={colSpan} height={6} />
              )}
              {visibleRows.map((row, r) => (
                <tr key={r}>
                  {payload.columns.map((column, c) => (
                    <td
                      key={c}
                      className={cn('whitespace-pre-line break-words align-middle', alignClass(column.align))}
                      style={cellStyle}
                    >
                      {row[c]}
                    </td>
                  ))}
                </tr>
              ))}
              {hidden > 0 ? (
                <tr>
                  <td
                    colSpan={colSpan}
                    className="text-center italic text-neutral-500"
                    style={{ padding: `${pt(4)} 0` }}
                  >
                    … дахин {hidden.toLocaleString('en-US')} мөр PDF-д орно (2 дахь хуудаснаас баганын нэргүй)
                  </td>
                </tr>
              ) : null}
              {payload.afterRows.length > 0 ? <Spacer colSpan={colSpan} height={7.55} /> : null}
              {payload.afterRows.map((row, i) => (
                <Fragment key={`after-${i}`}>
                  {i > 0 ? <Spacer colSpan={colSpan} height={10.55} /> : null}
                  <SummaryRow row={row} columns={payload.columns} />
                </Fragment>
              ))}
            </tbody>
          </table>
          {payload.afterRows.length > 0 ? (
            <div
              className="border-b-neutral-900"
              style={{ marginTop: pt(7), borderBottomWidth: pt(1.5), borderBottomStyle: 'solid' }}
            />
          ) : null}
          {afterContent}

          <div
            className="border-t-[4px] border-double border-neutral-900 text-neutral-700"
            style={{
              marginTop: pt(24),
              marginLeft: pt(-6),
              marginRight: pt(-6),
              paddingTop: pt(7.5),
              fontSize: pt(5.25),
            }}
          >
            <div className="flex justify-between gap-4">
              <span className="truncate">{footer}</span>
              <span className="shrink-0">Хуудас 1 - …</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
