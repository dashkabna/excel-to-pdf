'use client'

import { AlignCenter, AlignLeft, AlignRight, ArrowDown, ArrowUp, Plus, RotateCcw, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { cn } from '@/lib/utils'
import {
  CELL_FORMATS,
  STATEMENT_LIMITS,
  cellText,
  columnLetter,
  headerText,
  type CellFormat,
  type ColumnAlign,
  type ParsedSheet,
  type SheetLayout,
  type StatementColumnConfig,
} from '../lib/statement-xlsx'

const NONE = 'none'

const ALIGNS: Array<{ value: ColumnAlign; label: string; icon: typeof AlignLeft }> = [
  { value: 'left', label: 'Зүүн', icon: AlignLeft },
  { value: 'center', label: 'Голд', icon: AlignCenter },
  { value: 'right', label: 'Баруун', icon: AlignRight },
]

const truncate = (value: string, max: number) => (value.length > max ? `${value.slice(0, max - 1)}…` : value)

type Props = {
  sheet: ParsedSheet
  layout: SheetLayout
  columns: StatementColumnConfig[]
  onChange: (columns: StatementColumnConfig[]) => void
  onAdd: () => void
  onReset: () => void
}

export function StatementColumnMapper({ sheet, layout, columns, onChange, onAdd, onReset }: Props) {
  const totalWidth = columns.reduce((sum, c) => sum + (Number.isFinite(c.width) ? c.width : 0), 0) || 1

  // Сонголтод толгойн нэр, байхгүй бол эхний өгөгдлийн мөрийн утгыг жишээ болгон харуулна.
  const sourceOptions = Array.from({ length: sheet.colCount }, (_, c) => {
    const header = headerText(sheet, layout, c)
    const sample = cellText(sheet.rows[layout.dataStart]?.[c] ?? null).replace(/\s+/g, ' ').trim()
    const hint = header || sample
    return { value: String(c), label: hint ? `${columnLetter(c)} · ${truncate(hint, 28)}` : columnLetter(c) }
  })

  const update = (id: string, patch: Partial<StatementColumnConfig>) =>
    onChange(columns.map((c) => (c.id === id ? { ...c, ...patch } : c)))

  const move = (index: number, delta: -1 | 1) => {
    const target = index + delta
    if (target < 0 || target >= columns.length) return
    const next = [...columns]
    ;[next[index], next[target]] = [next[target]!, next[index]!]
    onChange(next)
  }

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto rounded-lg border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10 text-center">#</TableHead>
              <TableHead className="min-w-[180px]">PDF баганын нэр</TableHead>
              <TableHead className="min-w-[200px]">Excel багана</TableHead>
              <TableHead className="min-w-[160px]">Формат</TableHead>
              <TableHead className="w-[116px]">Байрлал</TableHead>
              <TableHead className="w-[132px]">Өргөн</TableHead>
              <TableHead className="w-[112px] text-right">Үйлдэл</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {columns.map((column, index) => (
              <TableRow key={column.id}>
                <TableCell className="text-center text-[12px] tabular-nums text-text-secondary">{index + 1}</TableCell>
                <TableCell>
                  <Input
                    aria-label={`${index + 1}-р баганын нэр`}
                    value={column.label}
                    maxLength={60}
                    onChange={(e) => update(column.id, { label: e.target.value })}
                    className="h-8"
                  />
                </TableCell>
                <TableCell>
                  <Select
                    value={column.source === null ? NONE : String(column.source)}
                    onValueChange={(value) => update(column.id, { source: value === NONE ? null : Number(value) })}
                  >
                    <SelectTrigger className="h-8" aria-label={`${index + 1}-р баганын Excel эх сурвалж`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>— Хоосон —</SelectItem>
                      {sourceOptions.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </TableCell>
                <TableCell>
                  <Select value={column.format} onValueChange={(value) => update(column.id, { format: value as CellFormat })}>
                    <SelectTrigger className="h-8" aria-label={`${index + 1}-р баганын формат`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CELL_FORMATS.map((format) => (
                        <SelectItem key={format.value} value={format.value}>
                          {format.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </TableCell>
                <TableCell>
                  <div className="inline-flex rounded-md border border-border p-0.5" role="group" aria-label="Байрлал">
                    {ALIGNS.map(({ value, label, icon: Icon }) => (
                      <button
                        key={value}
                        type="button"
                        title={label}
                        aria-label={`${index + 1}-р багана: ${label}`}
                        aria-pressed={column.align === value}
                        onClick={() => update(column.id, { align: value })}
                        className={cn(
                          'flex h-7 w-8 items-center justify-center rounded text-text-secondary transition-colors',
                          column.align === value
                            ? 'bg-accent text-white'
                            : 'hover:bg-surface-raised hover:text-text-primary',
                        )}
                      >
                        <Icon className="h-3.5 w-3.5" />
                      </button>
                    ))}
                  </div>
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-1.5">
                    <Input
                      type="number"
                      aria-label={`${index + 1}-р баганын өргөн`}
                      min={0.3}
                      max={20}
                      step={0.05}
                      value={Number.isFinite(column.width) ? column.width : ''}
                      onChange={(e) => update(column.id, { width: e.target.valueAsNumber })}
                      className="h-8 w-[72px] tabular-nums"
                    />
                    <span className="w-9 text-right text-[11px] tabular-nums text-text-secondary">
                      {Math.round(((Number.isFinite(column.width) ? column.width : 0) / totalWidth) * 100)}%
                    </span>
                  </div>
                </TableCell>
                <TableCell>
                  <div className="flex justify-end gap-0.5">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={`${index + 1}-р баганыг дээш`}
                      disabled={index === 0}
                      onClick={() => move(index, -1)}
                    >
                      <ArrowUp className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={`${index + 1}-р баганыг доош`}
                      disabled={index === columns.length - 1}
                      onClick={() => move(index, 1)}
                    >
                      <ArrowDown className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={`${index + 1}-р баганыг устгах`}
                      disabled={columns.length <= 1}
                      onClick={() => onChange(columns.filter((c) => c.id !== column.id))}
                    >
                      <Trash2 className="h-3.5 w-3.5 text-[var(--color-danger)]" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" size="sm" onClick={onAdd} disabled={columns.length >= STATEMENT_LIMITS.columns}>
          <Plus className="h-3.5 w-3.5" />
          Багана нэмэх
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onReset}>
          <RotateCcw className="h-3.5 w-3.5" />
          Анхны загвар
        </Button>
        <span className="text-[12px] text-text-secondary">
          Өргөн нь харьцангуй жин — нийлбэрт эзлэх хувиар хуудсанд хуваарилагдана. Дээд тал нь {STATEMENT_LIMITS.columns} багана.
        </span>
      </div>
    </div>
  )
}
