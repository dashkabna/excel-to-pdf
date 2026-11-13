'use client'

import { useId, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react'
import { AlignCenter, AlignLeft, AlignRight, Bold, EyeOff, Plus, QrCode, RotateCcw, Trash2, Type } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import {
  BAND_LIMITS,
  CONTENT_HEIGHT_RATIO,
  FIXED_KINDS,
  FIXED_LABELS,
  HEADER_TEXT_LIMIT,
  LINE_HEIGHT_RATIO,
  LOGO_HEIGHT_RATIO,
  MAX_LINES,
  PAGE,
  PAGE_MARGIN,
  PREVIEW_PX as PX,
  VERIFICATION_CAPTION_GAP,
  VERIFICATION_CODE_PLACEHOLDER,
  VERIFICATION_GAP_RATIO,
  VERIFICATION_BASE_URL,
  VERIFICATION_LIMITS,
  VERIFICATION_URL_TOKEN,
  createMeasure,
  defaultVerificationText,
  fitVerificationCaption,
  getBox,
  kindOf,
  lineStep,
  moveElement,
  moveVerification,
  resizeBand,
  resizeElement,
  logoAnchor,
  logoScaleBounds,
  scaleLogo,
  setLogoSize,
  sizeLimits,
  updateBox,
  fitVerification,
  verificationGeometry,
  verificationParagraphs,
  visibleKeys,
  withColon,
  type ElementKey,
  type FieldBox,
  type HeaderBox,
  type HeaderDesign,
  type LogoCorner,
  type TextBox,
  type VerificationBox,
} from '../lib/statement-header-layout'
import type { ColumnAlign, Orientation } from '../lib/statement-xlsx'

/** QR блок толгойн хэсэгт биш, агуулгын төгсгөлд байрладаг тул тусдаа сонголтын түлхүүртэй. */
export const VERIFICATION_KEY = 'verification'
export type DesignerSelection = ElementKey | typeof VERIFICATION_KEY

export type HeaderDesignContent = {
  title: string
  fields: Array<{ id: string; label: string; value: string }>
  logoLines: string[]
  periodStart: string
  periodEnd: string
  printedDate: string
}

/** PDF нь энгийн фонтыг fill+stroke-оор тодруулдаг — үсгийн өргөн ижил үлдэнэ. */
const FAUX_BOLD: CSSProperties = { WebkitTextStroke: '0.04em currentColor' }

/** PDF шиг N мөрөөр тасалж сүүлийн мөрийг "…"-ээр төгсгөнө. */
function Clamp({ lines, className, style, children }: { lines: number; className?: string; style?: CSSProperties; children: ReactNode }) {
  return (
    <div
      className={cn('overflow-hidden whitespace-pre-wrap break-words', className)}
      style={{ display: '-webkit-box', WebkitLineClamp: lines, WebkitBoxOrient: 'vertical', ...style }}
    >
      {children}
    </div>
  )
}
const BAND_KEY = 'band'
/** Чирэх торны алхам (pt); Alt дарвал 0.1pt. */
const GRID_STEP = 0.5

const px = (value: number) => `${(value * PX).toFixed(2)}px`

export function elementName(key: ElementKey, content: HeaderDesignContent) {
  const kind = kindOf(key)
  if (kind === 'field') {
    const field = content.fields.find((f) => `field:${f.id}` === key)
    return `Талбар: ${field?.label.trim() || field?.value.trim() || '—'}`
  }
  if (kind === 'text') return 'Текст'
  return FIXED_LABELS[kind]
}

type Drag = {
  key: ElementKey | typeof BAND_KEY
  mode: 'move' | 'resize' | 'band' | `scale-${LogoCorner}`
  startX: number
  startY: number
  /** Эхний хөдөлгөөн дээр авна — pointerdown-ийн focus нь хэрэгслийн мөрийн оролтыг blur хийж засвар хадгалуулсны дараах дизайн. */
  origin: HeaderDesign | null
  moved: boolean
}

type BandProps = {
  design: HeaderDesign
  orientation: Orientation
  content: HeaderDesignContent
  /** Оруулсан PNG лого; байхгүй бол "TESO" бичиглэл. */
  logo?: { src: string; width: number; height: number } | null
  selected: DesignerSelection | null
  onSelect: (key: DesignerSelection | null) => void
  onChange: (design: HeaderDesign) => void
  onRemove: (key: ElementKey) => void
}

/**
 * Хуучин тайлангийн хэрэгслүүдийн (Crystal Reports, Access) "Page Header" хэсэгтэй адил:
 * элемент бүрийг чирж байрлуулна, сонгосон элементийн баруун ирмэгийг чирж өргөнийг
 * (логог доод булангаас нь харьцаагаар нь), доод тасархай шугамыг чирж хүснэгт эхлэх
 * өндрийг өөрчилнө.
 */
export function HeaderDesignBand({ design, orientation, content, logo, selected, onSelect, onChange, onRemove }: BandProps) {
  const page = PAGE[orientation]
  const [draft, setDraft] = useState<HeaderDesign | null>(null)
  const draftRef = useRef<HeaderDesign | null>(null)
  const drag = useRef<Drag | null>(null)
  const nodes = useRef(new Map<string, HTMLElement>())
  const shown = draft ?? design

  /** offsetHeight бүхэл px-ээр тайрагддаг тул бутархай өндөр; дор хаяж нэг мөр (сервер мөрийн өндрөөр хэмждэг). */
  const heightOf = (key: ElementKey) => {
    const box = getBox(shown, key)
    const oneLine = box ? lineStep(kindOf(key), box.fontSize) : 0
    const node = nodes.current.get(key)
    return Math.max(oneLine, node ? node.getBoundingClientRect().height / PX : 0)
  }
  const bounds = { pageW: page.w, heightOf }

  const setLive = (next: HeaderDesign | null) => {
    draftRef.current = next
    setDraft(next)
  }

  const begin = (event: PointerEvent<HTMLElement>, key: Drag['key'], mode: Drag['mode']) => {
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    // preventDefault нь хулганы focus шилжилтийг зогсоодог — сонгосон элемент сумаар хөдлөх,
    // Delete нь өөр элемент биш энийг устгах, хэрэгслийн мөрийн оролт blur болж хадгалагдахын тулд.
    event.currentTarget.closest<HTMLElement>('[tabindex]')?.focus({ preventScroll: true })
    event.currentTarget.setPointerCapture?.(event.pointerId)
    if (key !== BAND_KEY) onSelect(key)
    drag.current = { key, mode, startX: event.clientX, startY: event.clientY, origin: null, moved: false }
  }

  const move = (event: PointerEvent<HTMLElement>) => {
    const current = drag.current
    if (!current) return
    const dx = (event.clientX - current.startX) / PX
    const dy = (event.clientY - current.startY) / PX
    if (!current.moved && Math.hypot(dx, dy) < 1) return
    current.moved = true
    current.origin ??= design
    const origin = current.origin
    const step = event.altKey ? 0.1 : GRID_STEP
    if (current.mode === 'band') setLive(resizeBand(origin, dy, step, bounds))
    else if (current.mode === 'scale-left' || current.mode === 'scale-right')
      setLive(scaleLogo(origin, current.mode === 'scale-left' ? 'left' : 'right', dx, dy, step, page.w))
    else if (current.mode === 'resize') setLive(resizeElement(origin, current.key as ElementKey, dx, step, bounds))
    else setLive(moveElement(origin, current.key as ElementKey, dx, dy, step, bounds))
  }

  const end = () => {
    const current = drag.current
    drag.current = null
    const next = draftRef.current
    setLive(null)
    if (current?.moved && next) onChange(next)
  }

  const nudge = (event: KeyboardEvent<HTMLElement>, key: ElementKey) => {
    const delta = event.shiftKey ? 10 : 1
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [-delta, 0],
      ArrowRight: [delta, 0],
      ArrowUp: [0, -delta],
      ArrowDown: [0, delta],
    }
    if (moves[event.key]) {
      event.preventDefault()
      const [dx, dy] = moves[event.key]!
      onChange(moveElement(design, key, dx, dy, 0, bounds))
    } else if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault()
      onRemove(key)
    } else if (event.key === 'Escape') {
      onSelect(null)
      event.currentTarget.blur()
    }
  }

  const bandKey = (event: KeyboardEvent<HTMLElement>) => {
    const delta = event.shiftKey ? 10 : 1
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault()
      onChange(resizeBand(design, event.key === 'ArrowUp' ? -delta : delta, 0, bounds))
    }
  }

  // Үсэг томруулах, Y оруулах, текст уртасгах зэргээр элемент хүснэгтийн шугамаас доош гарвал
  // PDF түүнийг тайрна — шугамыг доош нь сунгаж (420pt хүртэл), эс бол элементийг дээш татна.
  useLayoutEffect(() => {
    if (draftRef.current) return
    let next = design
    for (const key of visibleKeys(design)) {
      const box = getBox(next, key)
      if (!box) continue
      const h = heightOf(key)
      if (box.y + h <= next.bandHeight + 0.05) continue
      const band = Math.min(BAND_LIMITS.max, Math.ceil((box.y + h) * 2) / 2)
      if (band > next.bandHeight) next = { ...next, bandHeight: band }
      if (box.y + h > next.bandHeight + 0.05) next = updateBox(next, key, { y: Math.max(0, Math.floor((next.bandHeight - h) * 2) / 2) })
    }
    if (next !== design) onChange(next)
  })

  const renderElement = (
    key: ElementKey,
    box: HeaderBox,
    children: ReactNode,
    opts: { boldFont?: boolean; image?: boolean } = {},
  ) => {
    const kind = kindOf(key)
    const step = lineStep(kind, box.fontSize)
    // CSS мөрийн өндрийн дээд хагас зайг хасч эхний мөрийн суурь шугамыг pdfkit-тэй тааруулна (зурагт хамаарахгүй).
    const halfLeading = opts.image ? 0 : (step - box.fontSize * CONTENT_HEIGHT_RATIO) / 2
    const isSelected = selected === key
    return (
      <div
        key={key}
        ref={(node) => {
          if (node) nodes.current.set(key, node)
          else nodes.current.delete(key)
        }}
        role="button"
        tabIndex={0}
        aria-label={`${elementName(key, content)} — чирж байрлуулах`}
        aria-pressed={isSelected}
        className={cn(
          'absolute cursor-move touch-none select-none outline-none',
          isSelected
            ? 'z-10 outline outline-1 outline-[var(--color-accent)]'
            : 'hover:outline hover:outline-1 hover:outline-dashed hover:outline-neutral-400',
        )}
        style={{
          left: px(box.x),
          top: px(box.y - halfLeading),
          width: px(box.w),
          fontSize: px(box.fontSize),
          lineHeight: px(step),
          textAlign: box.align,
          fontWeight: opts.boldFont ? 700 : 400,
          ...(box.bold && !opts.boldFont ? FAUX_BOLD : {}),
        }}
        onPointerDown={(event) => begin(event, key, 'move')}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
        onKeyDown={(event) => nudge(event, key)}
        onFocus={() => onSelect(key)}
      >
        {children}
        {isSelected && kind === 'logo' ? (
          // Лого харьцаагаа хадгалан томорно — хоёр доод булангаас (баруун дээд буланд байрлах логог зүүн булангаас).
          (['left', 'right'] as const).map((corner) => (
            <span
              key={corner}
              aria-hidden
              data-logo-corner={corner}
              className={cn(
                'absolute -bottom-1 h-2.5 w-2.5 rounded-sm border border-white bg-[var(--color-accent)]',
                corner === 'left' ? '-left-1 cursor-nesw-resize' : '-right-1 cursor-nwse-resize',
              )}
              onPointerDown={(event) => begin(event, key, `scale-${corner}`)}
              onPointerMove={move}
              onPointerUp={end}
              onPointerCancel={end}
            />
          ))
        ) : isSelected ? (
          <span
            aria-hidden
            className="absolute -right-1 top-1/2 h-3 w-2 -translate-y-1/2 cursor-ew-resize rounded-sm border border-white bg-[var(--color-accent)]"
            onPointerDown={(event) => begin(event, key, 'resize')}
            onPointerMove={move}
            onPointerUp={end}
            onPointerCancel={end}
          />
        ) : null}
      </div>
    )
  }

  const placeholder = (text: string) => <span className="italic text-neutral-400">{text}</span>
  const elements: ReactNode[] = []

  for (const kind of FIXED_KINDS) {
    const box = shown.fixed[kind]
    if (box.hidden) continue
    const key = `fixed:${kind}` as const
    if (kind === 'logo' && logo) {
      // Сервертэй ижил: зураг w × (хэмжээ × 26/22) хайрцагт харьцаагаа хадгалан багтана (томсгож ч болно).
      const boxH = box.fontSize * LOGO_HEIGHT_RATIO
      const scale = Math.min(box.w / logo.width, boxH / logo.height)
      elements.push(
        renderElement(
          key,
          box,
          <div className="flex" style={{ height: px(boxH), justifyContent: box.align === 'right' ? 'flex-end' : box.align === 'center' ? 'center' : 'flex-start' }}>
            {/* eslint-disable-next-line @next/next/no-img-element -- data URL, next/image шаардлагагүй */}
            <img src={logo.src} alt="Байгууллагын лого" draggable={false} style={{ width: px(logo.width * scale), height: px(logo.height * scale) }} />
          </div>,
          { image: true },
        ),
      )
    } else if (kind === 'logo') {
      elements.push(
        renderElement(key, box, <span className="whitespace-nowrap text-[#0b2e59]">TESO</span>, { boldFont: true }),
      )
    } else if (kind === 'logoLines') {
      const lines = content.logoLines.filter((line) => line.trim())
      elements.push(
        renderElement(
          key,
          box,
          lines.length > 0
            ? lines.map((line, i) => (
                <div key={i} className="truncate">
                  {line}
                </div>
              ))
            : placeholder('Логоны доорх мэдээлэл'),
        ),
      )
    } else if (kind === 'title') {
      elements.push(renderElement(key, box, <Clamp lines={MAX_LINES.title ?? 2}>{content.title.trim() || placeholder('Гарчиг')}</Clamp>))
    } else {
      const value = kind === 'periodStart' ? content.periodStart : kind === 'periodEnd' ? content.periodEnd : content.printedDate
      const label = `${FIXED_LABELS[kind]}: `
      elements.push(
        renderElement(
          key,
          box,
          <div className="truncate">{value.trim() ? `${label}${value.trim()}` : placeholder(`${label}—`)}</div>,
        ),
      )
    }
  }

  for (const field of content.fields) {
    const key = `field:${field.id}` as const
    const box = shown.fields[field.id] as FieldBox | undefined
    if (!box) continue
    const label = withColon(field.label.trim())
    const value = field.value.trim()
    elements.push(
      renderElement(
        key,
        box,
        box.labelWidth > 0 ? (
          <div className="flex items-start">
            <Clamp lines={MAX_LINES.field ?? 3} className="shrink-0 text-left" style={{ width: px(Math.min(box.labelWidth, box.w)) }}>
              {label}
            </Clamp>
            <Clamp lines={MAX_LINES.field ?? 3} className="min-w-0 flex-1">
              {value}
            </Clamp>
          </div>
        ) : (
          <Clamp lines={MAX_LINES.field ?? 3}>{[label, value].filter(Boolean).join(' ')}</Clamp>
        ),
      ),
    )
  }

  for (const text of shown.texts) {
    elements.push(
      renderElement(
        `text:${text.id}`,
        text,
        <Clamp lines={MAX_LINES.text ?? 4}>{text.text.trim() || placeholder('Текст')}</Clamp>,
      ),
    )
  }

  return (
    <div
      className="relative"
      style={{
        width: px(page.w),
        height: px(shown.bandHeight),
        backgroundImage: 'radial-gradient(circle, rgba(15, 23, 42, 0.14) 0.7px, transparent 0.8px)',
        backgroundSize: `${px(10)} ${px(10)}`,
      }}
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onSelect(null)
      }}
    >
      {elements}
      <div
        role="separator"
        aria-orientation="horizontal"
        aria-label="Хүснэгт эхлэх шугам — чирж толгойн өндрийг өөрчлөх"
        aria-valuenow={Math.round(shown.bandHeight)}
        tabIndex={0}
        // Барих талбай шугамын доор л байна — шугамд тулсан элементийг (огнооны мөр) сонгоход саад болохгүй.
        className="group absolute inset-x-0 top-full z-20 h-2 cursor-row-resize touch-none outline-none"
        onPointerDown={(event) => begin(event, BAND_KEY, 'band')}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
        onKeyDown={bandKey}
      >
        <div className="absolute inset-x-0 top-0 border-t border-dashed border-[var(--color-accent)] opacity-60 group-hover:opacity-100 group-focus-visible:opacity-100" />
        <span className="absolute right-1 top-0 rounded bg-[var(--color-accent)] px-1.5 py-px text-[10px] leading-4 text-white opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100">
          Толгой · {Math.round(shown.bandHeight)}pt
        </span>
      </div>
    </div>
  )
}

type ToolbarProps = {
  design: HeaderDesign
  orientation: Orientation
  content: HeaderDesignContent
  selected: DesignerSelection | null
  onChange: (design: HeaderDesign) => void
  onAddText: () => void
  onReset: () => void
  onRemove: (key: DesignerSelection) => void
}

const ALIGNS: Array<{ value: ColumnAlign; label: string; icon: typeof AlignLeft }> = [
  { value: 'left', label: 'Зүүн', icon: AlignLeft },
  { value: 'center', label: 'Голд', icon: AlignCenter },
  { value: 'right', label: 'Баруун', icon: AlignRight },
]

/**
 * Бичиж буй текстийг ("10." гэх мэт) өөртөө барина. Ноорог нь бичих үеийн утгатай холбоотой —
 * элементийг чирэх эсвэл өөр элемент сонгоход утга өөрчлөгдөж ноорог хаягдана, blur нь хуучин
 * тоог буцааж бичихгүй. Хүрээнд орсон утгыг шууд, бусдыг blur/Enter үед хумьж хэрэглэнэ.
 */
function NumberField({ label, value, min, max, step = 0.5, onCommit }: {
  label: string
  value: number
  min: number
  max: number
  step?: number
  onCommit: (value: number) => void
}) {
  const [draft, setDraft] = useState<{ text: string; base: number } | null>(null)
  // Хэмжээг 0.01-ээр бүхэлчилдэг тул хадгалсан утга бичсэнээс бага зөрж болно (логоны өндөр) — ноорог хэвээр үлдэнэ.
  const active = draft && Math.abs(draft.base - value) < 0.01 ? draft : null
  const commitDraft = () => {
    const next = Number(active?.text)
    if (active && active.text.trim() !== '' && Number.isFinite(next)) {
      const clamped = Math.min(Math.max(next, min), max)
      if (clamped !== value) onCommit(clamped)
    }
    setDraft(null)
  }
  return (
    <label className="flex items-center gap-1 text-[12px] text-text-secondary">
      {label}
      <Input
        type="number"
        aria-label={label}
        min={min}
        max={max}
        step={step}
        value={active ? active.text : String(Number(value.toFixed(2)))}
        onChange={(event) => {
          const text = event.target.value
          const next = event.target.valueAsNumber
          if (Number.isFinite(next) && next >= min && next <= max) {
            setDraft({ text, base: next })
            onCommit(next)
          } else {
            setDraft({ text, base: value })
          }
        }}
        onBlur={commitDraft}
        onKeyDown={(event) => {
          if (event.key === 'Enter') commitDraft()
        }}
        className="h-7 w-[68px] px-2 text-[12px] tabular-nums"
      />
    </label>
  )
}

/** Сонгосон элементийн шинж чанар (байрлал, хэмжээ, үсэг) ба толгойн ерөнхий үйлдлүүд. */
export function HeaderDesignToolbar({ design, orientation, content, selected, onChange, onAddText, onReset, onRemove }: ToolbarProps) {
  const page = PAGE[orientation]
  const element = selected && selected !== VERIFICATION_KEY ? selected : null
  const box = element ? getBox(design, element) : null
  const kind = element ? kindOf(element) : null
  const v = design.verification
  // QR хэмжээ/өргөн/X өөрчлөгдөхөд блок хуудасны баруун margin-аас гарахгүй — тайлбар (код, анхааруулга) заавал харагдана.
  const setVerification = (patch: Partial<VerificationBox>) =>
    onChange({ ...design, verification: fitVerification({ ...v, ...patch }, orientation) })
  const vGeometry = verificationGeometry(v, orientation)
  const [measure] = useState(createMeasure)
  const fitted = fitVerificationCaption(v, orientation, measure)
  const hidden = FIXED_KINDS.filter((k) => design.fixed[k].hidden)
  const set = (patch: Partial<FieldBox & { text: string }>) => element && onChange(updateBox(design, element, patch))
  // Логоны тоон талбарууд харьцаагаар томруулах бодит хүрээтэй — "100" бичихэд "1", "10" хэрэглэгдэхгүй.
  const logoBounds = logoScaleBounds(design, logoAnchor(design, page.w), page.w)
  const logoH = design.fixed.logo.fontSize * LOGO_HEIGHT_RATIO

  return (
    <div className="space-y-2 rounded-lg border border-border bg-surface px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" size="sm" onClick={onAddText} disabled={design.texts.length >= HEADER_TEXT_LIMIT}>
          <Type className="h-3.5 w-3.5" />
          Текст нэмэх
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onReset}>
          <RotateCcw className="h-3.5 w-3.5" />
          Анхны байрлал
        </Button>
        {hidden.map((k) => (
          <Button
            key={k}
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onChange(updateBox(design, `fixed:${k}`, { hidden: false }))}
          >
            <Plus className="h-3.5 w-3.5" />
            {FIXED_LABELS[k]}
          </Button>
        ))}
        {v.hidden ? (
          <Button type="button" variant="ghost" size="sm" onClick={() => setVerification({ hidden: false })}>
            <Plus className="h-3.5 w-3.5" />
            Баталгаажуулах QR
          </Button>
        ) : null}
        <span className="ml-auto text-[12px] text-text-secondary">
          Толгойн элементийг чирж байрлуулна · сум 1pt, Shift+сум 10pt · Alt — нарийн · доод тасархай шугам — хүснэгт эхлэх
          · {visibleKeys(design).length} элемент
        </span>
      </div>

      {selected === VERIFICATION_KEY && !v.hidden ? (
        <div key={selected} className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-border pt-2">
          <span className="text-[12px] font-semibold text-text-primary">Баталгаажуулах QR</span>
          <NumberField
            label="X"
            value={v.x}
            min={0}
            max={vGeometry.maxX}
            onCommit={(x) => setVerification({ x })}
          />
          <NumberField
            label="Зай"
            value={v.gap}
            min={VERIFICATION_LIMITS.gap.min}
            max={VERIFICATION_LIMITS.gap.max}
            onCommit={(gap) => setVerification({ gap })}
          />
          <NumberField
            label="QR хэмжээ"
            value={v.size}
            min={VERIFICATION_LIMITS.size.min}
            max={VERIFICATION_LIMITS.size.max}
            step={1}
            onCommit={(size) => setVerification({ size })}
          />
          <NumberField
            label="Тайлбарын өргөн"
            value={v.w}
            min={VERIFICATION_LIMITS.w.min}
            max={vGeometry.maxCaptionW}
            onCommit={(w) => setVerification({ w })}
          />
          <NumberField
            label="Үсэг"
            value={v.fontSize}
            min={VERIFICATION_LIMITS.fontSize.min}
            max={VERIFICATION_LIMITS.fontSize.max}
            step={0.25}
            onCommit={(fontSize) => setVerification({ fontSize })}
          />
          <Button type="button" variant="ghost" size="sm" onClick={() => onRemove(VERIFICATION_KEY)} className="ml-auto text-[var(--color-danger)]">
            <EyeOff className="h-3.5 w-3.5" />
            Нуух
          </Button>
          {fitted.adjusted || fitted.clipped ? (
            <p className="basis-full text-[11px] text-[var(--color-warning,#b45309)]" role="status">
              Тайлбар нэг хуудсанд багтахгүй тул PDF-д {Number(fitted.captionW.toFixed(1))}pt өргөн,{' '}
              {fitted.fontSize}pt үсгээр хэвлэгдэнэ{fitted.clipped ? ', текстийн илүү мөрүүд тайрагдана' : ''}.
            </p>
          ) : null}
          <VerificationTextField value={v.text} onChange={(text) => setVerification({ text })} />
        </div>
      ) : null}

      {element && box && kind ? (
        <div key={element} className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-border pt-2">
          <span className="max-w-[220px] truncate text-[12px] font-semibold text-text-primary">{elementName(element, content)}</span>
          <NumberField label="X" value={box.x} min={0} max={Math.max(0, page.w - box.w)} onCommit={(x) => set({ x })} />
          <NumberField
            label="Y"
            value={box.y}
            min={0}
            max={Math.max(0, design.bandHeight - lineStep(kind, box.fontSize))}
            onCommit={(y) => set({ y })}
          />
          {kind === 'logo' ? (
            // Логоны өргөн ч харьцаагаар нь томруулна — өндөр нь дагана.
            <NumberField
              label="Өргөн"
              value={box.w}
              min={Math.max(8, logoBounds.baseW * logoBounds.min)}
              max={logoBounds.baseW * logoBounds.max}
              onCommit={(width) => onChange(setLogoSize(design, { width }, page.w))}
            />
          ) : (
            <NumberField label="Өргөн" value={box.w} min={12} max={page.w - box.x} onCommit={(w) => set({ w })} />
          )}
          {kind === 'logo' ? (
            // Логог өндрөөр (pt) нь өөрчилнө; өргөн харьцаагаараа дагана — буланаас чирэхтэй ижил.
            <NumberField
              label="Өндөр"
              value={logoH}
              min={logoH * logoBounds.min}
              max={logoH * logoBounds.max}
              onCommit={(height) => onChange(setLogoSize(design, { height }, page.w))}
            />
          ) : (
            <NumberField
              label="Үсэг"
              value={box.fontSize}
              min={sizeLimits(kind).min}
              max={sizeLimits(kind).max}
              step={0.25}
              onCommit={(fontSize) => {
                // Хайрцаг үсэгтэйгээ хамт томорч/жижгэрнэ — гарчгийг томруулахад мөр таслагдахгүй.
                const ratio = fontSize / box.fontSize
                const w = Math.min(Math.max(box.w * ratio, 12), page.w - box.x)
                set({
                  fontSize,
                  w,
                  ...(kind === 'field' ? { labelWidth: Math.min((box as FieldBox).labelWidth * ratio, w) } : {}),
                })
              }}
            />
          )}
          {kind === 'field' ? (
            <NumberField
              label="Нэрийн өргөн"
              value={(box as FieldBox).labelWidth}
              min={0}
              max={box.w}
              onCommit={(labelWidth) => set({ labelWidth })}
            />
          ) : null}
          {kind !== 'logo' ? (
            <Button
              type="button"
              variant={box.bold ? 'default' : 'outline'}
              size="icon"
              aria-label="Тод"
              aria-pressed={box.bold}
              onClick={() => set({ bold: !box.bold })}
              className="h-7 w-7"
            >
              <Bold className="h-3.5 w-3.5" />
            </Button>
          ) : null}
          <div className="inline-flex rounded-md border border-border p-0.5" role="group" aria-label="Байрлал">
            {ALIGNS.map(({ value, label, icon: Icon }) => (
              <button
                key={value}
                type="button"
                title={label}
                aria-label={label}
                aria-pressed={box.align === value}
                onClick={() => set({ align: value })}
                className={cn(
                  'flex h-6 w-7 items-center justify-center rounded text-text-secondary transition-colors',
                  box.align === value ? 'bg-accent text-white' : 'hover:bg-surface-raised hover:text-text-primary',
                )}
              >
                <Icon className="h-3.5 w-3.5" />
              </button>
            ))}
          </div>
          {kind === 'text' ? (
            <Input
              aria-label="Текст"
              value={(box as TextBox).text}
              maxLength={200}
              onChange={(event) => set({ text: event.target.value })}
              className="h-7 w-[220px] text-[12px]"
            />
          ) : null}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onRemove(element)}
            className="ml-auto text-[var(--color-danger)]"
          >
            {kind === 'text' || kind === 'field' ? <Trash2 className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
            {kind === 'text' || kind === 'field' ? 'Устгах' : 'Нуух'}
          </Button>
        </div>
      ) : null}
    </div>
  )
}

/**
 * QR-ийн хажуугийн тайлбар. Мөр бүр PDF-д тусдаа догол мөр болно; кодын мөр ба
 * "албан ёсны баримт биш" мөр тогтмол тул энд засагдахгүй.
 */
function VerificationTextField({ value, onChange }: { value: string; onChange: (text: string) => void }) {
  const L = VERIFICATION_LIMITS
  const id = useId()
  const lines = verificationParagraphs(value).length
  const over = lines > L.textLines
  const isDefault = value === defaultVerificationText()
  return (
    <div className="basis-full space-y-1">
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor={`${id}-text`} className="text-[12px] text-text-secondary">
          Тайлбарын текст
        </label>
        <span
          id={`${id}-count`}
          aria-live="polite"
          className={cn('text-[11px] tabular-nums', over ? 'text-[var(--color-danger)]' : 'text-text-secondary')}
        >
          {value.length}/{L.textChars} тэмдэгт · {lines}/{L.textLines} мөр
        </span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="ml-auto h-6"
          disabled={isDefault}
          onClick={() => onChange(defaultVerificationText())}
        >
          <RotateCcw className="h-3.5 w-3.5" />
          Анхны текст
        </Button>
      </div>
      <Textarea
        id={`${id}-text`}
        rows={3}
        maxLength={L.textChars}
        value={value}
        aria-invalid={over || undefined}
        aria-describedby={[`${id}-count`, `${id}-hint`, over ? `${id}-over` : null].filter(Boolean).join(' ')}
        onChange={(event) => onChange(event.target.value)}
        className="text-[12px]"
      />
      <p id={`${id}-hint`} className="text-[11px] text-text-secondary">
        Мөр бүр тусдаа догол мөр болно ({L.textLines} мөр хүртэл). {VERIFICATION_URL_TOKEN} нь шалгах хаягаар (
        {VERIFICATION_BASE_URL}) солигдоно. Дээд талын &quot;Баталгаажуулах код&quot; мөр ба доод талын &quot;албан ёсны
        баримт биш&quot; мөр тогтмол.
      </p>
      {over ? (
        <p id={`${id}-over`} className="text-[11px] text-[var(--color-danger)]">
          Эхний {L.textLines} мөр л хэвлэгдэнэ.
        </p>
      ) : null}
    </div>
  )
}

/** Экспорт хийхээс өмнө код үүсээгүй — QR-ийн оронд хоосон загвар (гурван булангийн тэмдэг). */
function QrPlaceholder({ size }: { size: number }) {
  const finder = (position: string) => (
    <span
      className={cn('absolute border-neutral-700', position)}
      style={{ width: px(size * 0.24), height: px(size * 0.24), borderWidth: px(size * 0.035), borderStyle: 'solid' }}
    >
      <span className="absolute inset-[26%] bg-neutral-700" />
    </span>
  )
  return (
    <div
      aria-hidden
      className="relative shrink-0 border border-dashed border-neutral-400 bg-white"
      style={{ width: px(size), height: px(size) }}
    >
      {finder('left-[6%] top-[6%]')}
      {finder('right-[6%] top-[6%]')}
      {finder('bottom-[6%] left-[6%]')}
      <span className="absolute inset-0 flex items-center justify-center text-[10px] tracking-wide text-neutral-400">QR</span>
    </div>
  )
}

type VerificationProps = {
  design: HeaderDesign
  orientation: Orientation
  selected: DesignerSelection | null
  onSelect: (key: DesignerSelection | null) => void
  onChange: (design: HeaderDesign) => void
}

/**
 * Хүснэгт/хураангуйн доорх баталгаажуулах QR блок. Хэвтээ чирэхэд X, босоо чирэхэд
 * агуулгаас дээрх зай өөрчлөгдөнө. Жинхэнэ QR ба код PDF үүсгэх үед серверт үүснэ.
 */
export function VerificationBlock({ design, orientation, selected, onSelect, onChange }: VerificationProps) {
  const [draft, setDraft] = useState<VerificationBox | null>(null)
  const draftRef = useRef<VerificationBox | null>(null)
  const drag = useRef<{ startX: number; startY: number; origin: VerificationBox | null; moved: boolean } | null>(null)
  const [measure] = useState(createMeasure)
  const v = draft ?? design.verification
  if (design.verification.hidden) return null

  const isSelected = selected === VERIFICATION_KEY
  const setLive = (next: VerificationBox | null) => {
    draftRef.current = next
    setDraft(next)
  }
  const commit = (next: VerificationBox) => onChange({ ...design, verification: next })

  const geometry = verificationGeometry(v, orientation)
  // PDF-ийн нэг хуудсанд багтаалттай ижил өргөн, үсэг, тайралтаар харуулна.
  const fitted = fitVerificationCaption(v, orientation, measure)
  const lineHeight = fitted.fontSize * (LINE_HEIGHT_RATIO + VERIFICATION_GAP_RATIO)
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label="Баталгаажуулах QR — чирж байрлуулах"
      aria-pressed={isSelected}
      className={cn(
        'relative flex cursor-move touch-none select-none items-start outline-none',
        isSelected
          ? 'outline outline-1 outline-[var(--color-accent)]'
          : 'hover:outline hover:outline-1 hover:outline-dashed hover:outline-neutral-400',
      )}
      style={{
        marginTop: px(v.gap),
        marginLeft: px(geometry.x - PAGE_MARGIN.left),
        width: px(v.size + VERIFICATION_CAPTION_GAP + fitted.captionW),
      }}
      onPointerDown={(event) => {
        if (event.button !== 0) return
        event.preventDefault()
        event.currentTarget.focus({ preventScroll: true })
        event.currentTarget.setPointerCapture?.(event.pointerId)
        onSelect(VERIFICATION_KEY)
        drag.current = { startX: event.clientX, startY: event.clientY, origin: null, moved: false }
      }}
      onPointerMove={(event) => {
        const current = drag.current
        if (!current) return
        const dx = (event.clientX - current.startX) / PX
        const dy = (event.clientY - current.startY) / PX
        if (!current.moved && Math.hypot(dx, dy) < 1) return
        current.moved = true
        current.origin ??= design.verification
        setLive(moveVerification(current.origin, dx, dy, event.altKey ? 0.1 : GRID_STEP, orientation))
      }}
      onPointerUp={() => {
        const current = drag.current
        drag.current = null
        const next = draftRef.current
        setLive(null)
        if (current?.moved && next) commit(next)
      }}
      onPointerCancel={() => {
        drag.current = null
        setLive(null)
      }}
      onKeyDown={(event) => {
        const delta = event.shiftKey ? 10 : 1
        const moves: Record<string, [number, number]> = {
          ArrowLeft: [-delta, 0],
          ArrowRight: [delta, 0],
          ArrowUp: [0, -delta],
          ArrowDown: [0, delta],
        }
        if (moves[event.key]) {
          event.preventDefault()
          const [dx, dy] = moves[event.key]!
          commit(moveVerification(design.verification, dx, dy, 0, orientation))
        } else if (event.key === 'Delete' || event.key === 'Backspace') {
          event.preventDefault()
          commit({ ...design.verification, hidden: true })
          onSelect(null)
        } else if (event.key === 'Escape') {
          onSelect(null)
          event.currentTarget.blur()
        }
      }}
      onFocus={() => onSelect(VERIFICATION_KEY)}
    >
      <QrPlaceholder size={v.size} />
      <div
        className="min-w-0 text-left text-neutral-900"
        style={{
          marginLeft: px(VERIFICATION_CAPTION_GAP),
          width: px(fitted.captionW),
          fontSize: px(fitted.fontSize),
          lineHeight: px(lineHeight),
        }}
      >
        {fitted.paragraphs.map(({ text, kept }, i) =>
          kept === null ? (
            <p key={i} className="whitespace-pre-wrap break-words" style={i === 0 ? FAUX_BOLD : undefined}>
              {text}
            </p>
          ) : kept > 0 ? (
            // PDF шиг тайрсан мөрийн тоогоор "…"-ээр төгсгөнө.
            <Clamp key={i} lines={kept} className="break-words">
              {text}
            </Clamp>
          ) : null,
        )}
      </div>
    </div>
  )
}
