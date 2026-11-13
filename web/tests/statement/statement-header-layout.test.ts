import { describe, expect, it } from 'vitest'
import {
  BAND_LIMITS,
  LINE_HEIGHT_RATIO,
  LOGO_HEIGHT_RATIO,
  LOGO_SIZE_LIMITS,
  PAGE,
  adaptHeaderDesign,
  addTextElement,
  defaultHeaderDesign,
  moveElement,
  resizeBand,
  resizeElement,
  resolveHeaderDesign,
  restoreHeaderDesign,
  scaleLogo,
  setLogoSize,
  serializeHeaderDesign,
  toHeaderLayout,
  updateBox,
  wrapLineCount,
  type HeaderContent,
  type Measure,
} from '@/features/statement/lib/statement-header-layout'

/** Үсгийн дундаж өргөн 0.5em — тест тодорхой тоо гаргахын тулд. */
const measure: Measure = (text, fontSize) => Array.from(text).length * fontSize * 0.5

const content = (overrides: Partial<HeaderContent> = {}): HeaderContent => ({
  title: 'Дансны дэлгэрэнгүй хуулга',
  fields: [
    { id: 'a', label: 'Харилцагчийн нэр', value: 'Тест' },
    { id: 'b', label: 'Дансны дугаар', value: '123' },
  ],
  logoLines: ['УЛААНБААТАР ХОТ', 'CENTRAL TOWER'],
  orientation: 'portrait',
  ...overrides,
})

const bounds = { pageW: PAGE.portrait.w, heightOf: () => 10 }

describe('defaultHeaderDesign', () => {
  it('stacks fields at the template step, logo block at the right margin, title centred beside the fields', () => {
    const design = defaultHeaderDesign(content(), measure)
    const step = 6.75 * LINE_HEIGHT_RATIO + 2.74
    expect(design.fields.a).toMatchObject({ x: 20.16, y: 9, fontSize: 6.75 })
    expect(design.fields.b!.y).toBeCloseTo(9 + step, 1)
    // 'Харилцагчийн нэр:' = 17 үсэг × 3.375 + 4
    expect(design.fields.a!.labelWidth).toBeCloseTo(17 * 6.75 * 0.5 + 4, 1)
    // Мэдээллийн мөр баруун margin-д тулна; "TESO" бичиглэлийн хайрцаг текстийн өргөнтэй, блокийн зүүн ирмэгт.
    expect(design.fixed.logoLines.x + design.fixed.logoLines.w).toBeCloseTo(PAGE.portrait.w - 29.37, 1)
    expect(design.fixed.logoLines.x).toBe(design.fixed.logo.x)
    expect(design.fixed.logo.w).toBeCloseTo(measure('TESO', 22, true) + 1, 1)
    expect(design.fixed.title).toMatchObject({ y: 58.7, align: 'center', bold: true })
    expect(design.fixed.title.x + design.fixed.title.w / 2).toBeCloseTo(PAGE.portrait.w / 2, 1)
    expect(design.fixed.printedDate.align).toBe('right')
    expect(design.bandHeight).toBeGreaterThan(design.fixed.periodStart.y)
  })

  it('moves the title below the header when a long field value would run into it', () => {
    const fields = Array.from({ length: 6 }, (_, i) => ({ id: `f${i}`, label: 'Нэр', value: 'x'.repeat(i === 4 ? 120 : 3) }))
    const design = defaultHeaderDesign(content({ fields }), measure)
    expect(design.fixed.title.y).toBeGreaterThan(58.7)
    expect(design.fixed.title.x).toBe(20.16)
  })
})

describe('toHeaderLayout', () => {
  it('numbers fields by visible order, skips hidden fixed elements and empty texts', () => {
    let design = defaultHeaderDesign(content(), measure)
    design = updateBox(design, 'fixed:logoLines', { hidden: true })
    design = addTextElement(design, 't1', 'portrait')
    design = addTextElement(design, 't2', 'portrait')
    design = updateBox(design, 'text:t2', { text: '   ' })
    const layout = toHeaderLayout(design, ['b', 'a'])
    const kinds = layout.elements.map((e) => e.kind)
    expect(kinds).not.toContain('logoLines')
    expect(kinds.filter((k) => k === 'text')).toHaveLength(1)
    expect(layout.elements.filter((e) => e.kind === 'field').map((e) => ('fieldIndex' in e ? e.fieldIndex : -1))).toEqual([0, 1])
    expect(layout.elements.find((e) => e.kind === 'field' && e.fieldIndex === 0)!.y).toBe(design.fields.b!.y)
  })
})

describe('resolveHeaderDesign', () => {
  it('keeps user positions, places a new field under the last one and drops removed ones', () => {
    const base = moveElement(defaultHeaderDesign(content(), measure), 'field:b', 100, 5, 0, bounds)
    const resolved = resolveHeaderDesign(
      base,
      content({
        fields: [
          { id: 'b', label: 'Дансны дугаар', value: '123' },
          { id: 'c', label: 'Салбар', value: 'Төв' },
        ],
      }),
      measure,
    )
    expect(resolved.fields.a).toBeUndefined()
    expect(resolved.fields.b).toEqual(base.fields.b)
    expect(resolved.fields.c!.x).toBe(base.fields.b!.x)
    expect(resolved.fields.c!.y).toBeCloseTo(base.fields.b!.y + 6.75 * LINE_HEIGHT_RATIO + 2.74, 1)
  })

  it('returns the defaults while nothing has been customised', () => {
    expect(resolveHeaderDesign(null, content(), measure)).toEqual(defaultHeaderDesign(content(), measure))
  })
})

describe('editing', () => {
  it('snaps the drag delta, not the absolute position, and stays inside the band and page', () => {
    const design = defaultHeaderDesign(content(), measure)
    const moved = moveElement(design, 'field:a', 10.3, 0.2, 0.5, bounds)
    expect(moved.fields.a!.x).toBeCloseTo(20.16 + 10.5, 2)
    expect(moved.fields.a!.y).toBe(9)
    const far = moveElement(design, 'field:a', -500, 9999, 0.5, bounds)
    expect(far.fields.a!.x).toBe(0)
    expect(far.fields.a!.y).toBeCloseTo(design.bandHeight - 10, 2)
  })

  it('does not let the band rise above the lowest element and respects the limits', () => {
    const design = defaultHeaderDesign(content(), measure)
    const lowest = design.fixed.periodStart.y + 10
    expect(resizeBand(design, -500, 0.5, bounds).bandHeight).toBeCloseTo(Math.ceil(lowest * 2) / 2, 2)
    expect(resizeBand(design, 5000, 0.5, bounds).bandHeight).toBe(BAND_LIMITS.max)
  })

  it('clamps width to the page edge', () => {
    const design = defaultHeaderDesign(content(), measure)
    const wide = resizeElement(design, 'fixed:title', 5000, 0.5, bounds)
    expect(wide.fixed.title.x + wide.fixed.title.w).toBeCloseTo(PAGE.portrait.w, 2)
  })
})

describe('adaptHeaderDesign', () => {
  it('keeps left items, moves right-aligned items to the new right edge and centred items to the new centre', () => {
    const design = defaultHeaderDesign(content(), measure)
    const delta = PAGE.landscape.w - PAGE.portrait.w
    const wide = adaptHeaderDesign(design, 'portrait', 'landscape')
    expect(wide.fields.a!.x).toBe(design.fields.a!.x)
    expect(wide.fixed.logo.x).toBeCloseTo(design.fixed.logo.x + delta, 1)
    expect(wide.fixed.printedDate.x).toBeCloseTo(design.fixed.printedDate.x + delta, 1)
    expect(wide.fixed.title.x).toBeCloseTo(design.fixed.title.x + delta / 2, 1)
    const back = adaptHeaderDesign(wide, 'landscape', 'portrait')
    expect(back.fixed.logo.x).toBeCloseTo(design.fixed.logo.x, 1)
  })
})

describe('template persistence', () => {
  it('round-trips through field order so new session ids keep their positions', () => {
    const design = moveElement(defaultHeaderDesign(content(), measure), 'field:b', 40, 20, 0, bounds)
    const saved = JSON.parse(JSON.stringify(serializeHeaderDesign(design, ['a', 'b'])))
    const restored = restoreHeaderDesign(saved, ['x', 'y'])!
    expect(restored.fields.y).toEqual(design.fields.b)
    expect(restored.fields.x).toEqual(design.fields.a)
    expect(restored.bandHeight).toBe(design.bandHeight)
  })

  it('rejects malformed saved designs', () => {
    expect(restoreHeaderDesign({ bandHeight: 'big' }, ['a'])).toBeNull()
    expect(restoreHeaderDesign({ bandHeight: 90, fixed: {} }, ['a'])).toBeNull()
    expect(restoreHeaderDesign(null, ['a'])).toBeNull()
  })
})

describe('review regressions', () => {
  const step = 6.75 * LINE_HEIGHT_RATIO + 2.74

  it('stacks fields by their wrapped height so long values do not overlap the next field', () => {
    const long = 'Улаанбаатар хот, Сүхбаатар дүүрэг, 1-р хороо, Чингисийн өргөн чөлөө, Central Tower, 12 давхар, 1201 тоот'
    const design = defaultHeaderDesign(
      content({ fields: [{ id: 'a', label: 'Хаяг', value: `${long}, ${long}` }, { id: 'b', label: 'Утас', value: '7000' }] }),
      measure,
    )
    const lines = Math.min(3, wrapLineCount(`${long}, ${long}`, design.fields.a!.w - design.fields.a!.labelWidth, 6.75, measure))
    expect(lines).toBeGreaterThan(1)
    expect(design.fields.b!.y).toBeCloseTo(9 + lines * step, 1)
  })

  it('reserves two lines for a long title placed under the header', () => {
    const title = 'Дансны дэлгэрэнгүй хуулга — 2026 оны 1-р улирлын нэгдсэн тайлан, бүх салбарын гүйлгээ, үлдэгдэл, шимтгэл'
    const design = defaultHeaderDesign(content({ title }), measure)
    expect(design.fixed.title.x).toBe(20.16)
    expect(design.fixed.periodStart.y).toBeGreaterThanOrEqual(design.fixed.title.y + 2 * 11.7 * LINE_HEIGHT_RATIO)
  })

  it('inserts new fields under the last one and pushes lower elements and the band down', () => {
    const base = moveElement(defaultHeaderDesign(content(), measure), 'fixed:logo', 1, 0, 0, bounds)
    const resolved = resolveHeaderDesign(
      base,
      content({
        fields: [
          ...content().fields,
          { id: 'c', label: 'Салбар', value: '1' },
          { id: 'd', label: 'Валют', value: 'MNT' },
        ],
      }),
      measure,
    )
    expect(resolved.fields.c!.y).toBeCloseTo(base.fields.b!.y + step, 1)
    expect(resolved.fields.d!.y).toBeCloseTo(base.fields.b!.y + 2 * step, 1)
    expect(resolved.fixed.periodStart.y).toBeCloseTo(base.fixed.periodStart.y + 2 * step, 1)
    expect(resolved.bandHeight).toBeCloseTo(base.bandHeight + 2 * step, 1)
    // Дээрх элемент (лого) хөдлөхгүй.
    expect(resolved.fixed.logo).toEqual(base.fixed.logo)
  })

  it('keeps left-margin fields in place across orientation changes and inside the content area', () => {
    const portrait = defaultHeaderDesign(content(), measure)
    const landscape = adaptHeaderDesign(portrait, 'portrait', 'landscape')
    expect(landscape.fields.a!.x).toBe(20.16)
    const back = adaptHeaderDesign(defaultHeaderDesign(content({ orientation: 'landscape' }), measure), 'landscape', 'portrait')
    expect(back.fields.a!.x).toBe(20.16)
    expect(back.fields.a!.x + back.fields.a!.w).toBeLessThanOrEqual(PAGE.portrait.w - 29.37 + 0.01)
  })

  it('never sends a label width wider than its box', () => {
    const design = updateBox(defaultHeaderDesign(content(), measure), 'field:a', { labelWidth: 900, w: 300 })
    const field = toHeaderLayout(design, ['a']).elements.find((e) => e.kind === 'field')!
    expect('labelWidth' in field && field.labelWidth).toBe(300)
  })

  it('gives the logo and info line boxes a margin over the measured text', () => {
    const design = defaultHeaderDesign(content({ logoLines: ['x'.repeat(60)] }), measure)
    expect(design.fixed.logoLines.w).toBeGreaterThan(measure('x'.repeat(60), 5.63))
    expect(design.fixed.logo.w).toBeGreaterThan(measure('TESO', 22))
  })
})

describe('logo shape', () => {
  it('places info lines right under a square image logo like the server auto header', () => {
    const design = defaultHeaderDesign(content({ logo: { width: 100, height: 100 } }), measure)
    // 100×100 → 124×26 хайрцагт 26×26; мэдээлэл 9 + 26 + 3.3-аас эхэлнэ.
    expect(design.fixed.logo.w).toBeCloseTo(26, 1)
    expect(design.fixed.logoLines.y).toBeCloseTo(9 + 26 + 3.3, 1)
    expect(design.logoAspect).toBe(1)
  })

  it('refits a customised box when a logo is uploaded or removed, keeping its right edge', () => {
    const custom = moveElement(defaultHeaderDesign(content(), measure), 'fixed:logo', -20, 0, 0, bounds)
    expect(custom.logoAspect).toBeNull()
    const right = custom.fixed.logo.x + custom.fixed.logo.w

    const withLogo = resolveHeaderDesign(custom, content({ logo: { width: 400, height: 100 } }), measure)
    expect(withLogo.logoAspect).toBe(4)
    expect(withLogo.fixed.logo.w).toBeCloseTo(22 * (26 / 22) * 4, 1)
    expect(withLogo.fixed.logo.x + withLogo.fixed.logo.w).toBeCloseTo(right, 1)

    const removed = resolveHeaderDesign(withLogo, content(), measure)
    expect(removed.logoAspect).toBeNull()
    expect(removed.fixed.logo.w).toBeCloseTo(measure('TESO', 22, true) + 1, 1)
    expect(removed.fixed.logo.x + removed.fixed.logo.w).toBeCloseTo(right, 1)
  })

  it('treats designs saved before logo uploads existed as fitted to the wordmark', () => {
    const saved = JSON.parse(JSON.stringify(serializeHeaderDesign(defaultHeaderDesign(content(), measure), ['a', 'b'])))
    delete saved.logoAspect
    expect(restoreHeaderDesign(saved, ['a', 'b'])!.logoAspect).toBeNull()
  })
})

describe('scaleLogo', () => {
  const withLogo = () => defaultHeaderDesign(content({ logo: { width: 400, height: 100 } }), measure)
  const pageW = PAGE.portrait.w

  it('scales width and size by the same factor from the bottom-right corner, keeping the left edge', () => {
    // Анхдагч лого баруун ирмэгт тулсан — баруун булангаас томруулахын тулд зүүн тийш шилжүүлнэ.
    const d = updateBox(withLogo(), 'fixed:logo', { x: 40 })
    const box = d.fixed.logo
    const h = box.fontSize * LOGO_HEIGHT_RATIO
    // Диагоналиар хоёр дахин том болгох шилжилт.
    const next = scaleLogo(d, 'right', box.w, h, 0, pageW).fixed.logo
    expect(next.w).toBeCloseTo(box.w * 2, 0)
    expect(next.fontSize / box.fontSize).toBeCloseTo(next.w / box.w, 2)
    expect(next.x).toBe(box.x)
  })

  it('keeps the right edge when dragged from the bottom-left corner (logo in the top-right corner)', () => {
    const d = withLogo()
    const box = d.fixed.logo
    const right = box.x + box.w
    const next = scaleLogo(d, 'left', -60, 20, 0, pageW).fixed.logo
    expect(next.w).toBeGreaterThan(box.w)
    expect(next.x + next.w).toBeCloseTo(right, 1)
    expect(next.fontSize / box.fontSize).toBeCloseTo(next.w / box.w, 2)
  })

  it('stops at the size limit, the page edge and the band limit, and never shrinks below 4', () => {
    const d = withLogo()
    const huge = scaleLogo(d, 'left', -5000, 5000, 0, pageW).fixed.logo
    expect(huge.fontSize).toBeLessThanOrEqual(LOGO_SIZE_LIMITS.max)
    expect(huge.x).toBeGreaterThanOrEqual(0)
    expect(huge.y + huge.fontSize * LOGO_HEIGHT_RATIO).toBeLessThanOrEqual(BAND_LIMITS.max + 0.01)

    const right = scaleLogo(d, 'right', 5000, 5000, 0, pageW).fixed.logo
    expect(right.x + right.w).toBeLessThanOrEqual(pageW + 0.01)

    const tiny = scaleLogo(d, 'right', -5000, -5000, 0, pageW).fixed.logo
    expect(tiny.fontSize).toBeGreaterThanOrEqual(LOGO_SIZE_LIMITS.min - 0.01)
    expect(tiny.w).toBeGreaterThanOrEqual(12 - 0.01)
  })

  it('snaps the height to the drag grid', () => {
    const d = withLogo()
    const next = scaleLogo(d, 'right', 13.37, 4.21, 0.5, pageW).fixed.logo
    const height = next.fontSize * LOGO_HEIGHT_RATIO
    expect(Math.abs(height * 2 - Math.round(height * 2))).toBeLessThan(0.02)
  })

  it('sends logo sizes above 32 to the server (up to 120) while text stays capped, and restores them', () => {
    const d = withLogo()
    const big = updateBox(updateBox(d, 'fixed:logo', { fontSize: 100 }), 'fixed:title', { fontSize: 100 })
    const elements = toHeaderLayout(big, ['a', 'b']).elements
    expect(elements.find((e) => e.kind === 'logo')!.fontSize).toBe(100)
    expect(elements.find((e) => e.kind === 'title')!.fontSize).toBe(32)
    expect(toHeaderLayout(updateBox(d, 'fixed:logo', { fontSize: 500 }), ['a', 'b']).elements.find((e) => e.kind === 'logo')!.fontSize).toBe(120)

    const saved = JSON.parse(JSON.stringify(serializeHeaderDesign(big, ['a', 'b'])))
    const restored = restoreHeaderDesign(saved, ['a', 'b'])!
    expect(restored.fixed.logo.fontSize).toBe(100)
    expect(restored.fixed.title.fontSize).toBe(32)
  })
})

describe('logo aspect lock (review regressions)', () => {
  const pageW = PAGE.portrait.w
  const withLogo = (w = 400, h = 100) => defaultHeaderDesign(content({ logo: { width: w, height: h } }), measure)
  const aspectOf = (box: { w: number; fontSize: number }) => box.w / (box.fontSize * LOGO_HEIGHT_RATIO)

  it('keeps a scaled logo image-shaped and with its info lines when the orientation changes, and shrinks it to fit', () => {
    const portrait = setLogoSize(withLogo(), { height: 100 }, pageW)
    const before = portrait.fixed.logo
    const landscape = adaptHeaderDesign(portrait, 'portrait', 'landscape')
    expect(aspectOf(landscape.fixed.logo)).toBeCloseTo(aspectOf(before), 1)
    expect(landscape.fixed.logo.fontSize).toBe(before.fontSize)

    // Мэдээллийн мөртэй нэг зүүн ирмэгтэй лого тэдэнтэйгээ хамт шилжинэ.
    const block = withLogo()
    const moved = adaptHeaderDesign(block, 'portrait', 'landscape')
    expect(moved.fixed.logo.x).toBe(moved.fixed.logoLines.x)

    // Хэвтээ хуудсанд өргөн лого босоо руу шилжихэд харьцаагаараа жижгэрнэ.
    const wide = setLogoSize(adaptHeaderDesign(withLogo(), 'portrait', 'landscape'), { width: 760 }, PAGE.landscape.w)
    const back = adaptHeaderDesign(wide, 'landscape', 'portrait').fixed.logo
    expect(back.x + back.w).toBeLessThanOrEqual(pageW + 0.01)
    expect(aspectOf(back)).toBeCloseTo(aspectOf(wide.fixed.logo), 1)
  })

  it('lets the TESO wordmark reach the largest size and keeps it under the right-side info block', () => {
    const d = defaultHeaderDesign(content(), measure)
    const big = setLogoSize(d, { height: 120 * LOGO_HEIGHT_RATIO }, pageW).fixed.logo
    expect(big.fontSize).toBeCloseTo(120, 1)
    // Баруун дээд буланд байгаа тул баруун ирмэгээрээ бэхлэгдэж зүүн тийш томорно.
    expect(big.x + big.w).toBeCloseTo(d.fixed.logo.x + d.fixed.logo.w, 1)
  })

  it('narrows an old saved wordmark box to the text without moving the text', () => {
    const d = defaultHeaderDesign(content(), measure)
    const legacy = updateBox(d, 'fixed:logo', { w: 124 })
    const resolved = resolveHeaderDesign(legacy, content(), measure).fixed.logo
    expect(resolved.x).toBe(d.fixed.logo.x)
    expect(resolved.w).toBeCloseTo(measure('TESO', 22, true) + 1, 1)
  })

  it('never makes a tall, narrow logo grow when the user tries to shrink it', () => {
    const d = withLogo(100, 400)
    const h = d.fixed.logo.fontSize * LOGO_HEIGHT_RATIO
    expect(setLogoSize(d, { height: 20 }, pageW).fixed.logo.fontSize * LOGO_HEIGHT_RATIO).toBeLessThanOrEqual(h + 0.01)
    expect(scaleLogo(d, 'left', 1, -1, 0.5, pageW).fixed.logo.fontSize * LOGO_HEIGHT_RATIO).toBeLessThanOrEqual(h + 0.01)
  })

  it('scales by width too, so the toolbar width keeps the image shape', () => {
    const d = withLogo()
    const next = setLogoSize(d, { width: 52 }, pageW).fixed.logo
    expect(next.w).toBeCloseTo(52, 1)
    expect(aspectOf(next)).toBeCloseTo(4, 1)
  })
})

describe('logo placement after uploads and rotations (second review)', () => {
  const pageW = PAGE.portrait.w
  const right = pageW - 29.37

  it('keeps an uploaded logo on the left edge of its info block when it replaces the wordmark in an edited design', () => {
    const edited = updateBox(defaultHeaderDesign(content(), measure), 'fixed:title', { y: 70 })
    const withImage = resolveHeaderDesign(edited, content({ logo: { width: 496, height: 104 } }), measure)
    expect(withImage.fixed.logo.x).toBe(withImage.fixed.logoLines.x)
    expect(withImage.fixed.logo.x + withImage.fixed.logo.w).toBeLessThanOrEqual(right + 0.01)
  })

  it('keeps a small square logo without info text at the right margin across orientation round trips', () => {
    const d = updateBox(defaultHeaderDesign(content({ logoLines: [], logo: { width: 200, height: 200 } }), measure), 'fixed:title', { y: 70 })
    expect(d.fixed.logoLines.x + d.fixed.logoLines.w).toBeCloseTo(right, 1)
    const there = adaptHeaderDesign(d, 'portrait', 'landscape')
    expect(there.fixed.logo.x + there.fixed.logo.w).toBeCloseTo(PAGE.landscape.w - 29.37, 1)
    const back = adaptHeaderDesign(there, 'landscape', 'portrait')
    expect(back.fixed.logo.x + back.fixed.logo.w).toBeCloseTo(right, 1)
  })

  it('moves the logo with its hidden info lines, so unhiding them later shows the block together', () => {
    const d = updateBox(defaultHeaderDesign(content(), measure), 'fixed:logoLines', { hidden: true })
    const landscape = adaptHeaderDesign(d, 'portrait', 'landscape')
    expect(landscape.fixed.logo.x).toBe(landscape.fixed.logoLines.x)
  })

  it('gives a very narrow logo at least the server minimum 8pt box and still lets it shrink', () => {
    const d = defaultHeaderDesign(content({ logoLines: [], logo: { width: 100, height: 400 } }), measure)
    expect(d.fixed.logo.w).toBeGreaterThanOrEqual(8)
    const h = d.fixed.logo.fontSize * LOGO_HEIGHT_RATIO
    const smaller = setLogoSize(d, { height: 13 }, pageW).fixed.logo
    expect(smaller.fontSize * LOGO_HEIGHT_RATIO).toBeCloseTo(13, 1)
    expect(smaller.fontSize * LOGO_HEIGHT_RATIO).toBeLessThan(h)
    expect(smaller.w).toBeGreaterThanOrEqual(8)
  })
})

describe('logo shape stays the image shape (final review)', () => {
  const pageW = PAGE.portrait.w
  const aspectOf = (box: { w: number; fontSize: number }) => box.w / (box.fontSize * LOGO_HEIGHT_RATIO)

  it('keeps a square logo square after shrinking it to the minimum and growing it back', () => {
    const d = defaultHeaderDesign(content({ logoLines: [], logo: { width: 200, height: 200 } }), measure)
    const tiny = setLogoSize(d, { height: 1 }, pageW)
    expect(tiny.fixed.logo.w).toBeGreaterThanOrEqual(8)
    const back = setLogoSize(tiny, { height: 50 }, pageW).fixed.logo
    expect(back.fontSize * LOGO_HEIGHT_RATIO).toBeCloseTo(50, 1)
    expect(aspectOf(back)).toBeCloseTo(1, 1)
    const dragged = scaleLogo(tiny, 'left', -60, 60, 0, pageW).fixed.logo
    expect(aspectOf(dragged)).toBeCloseTo(1, 1)
  })

  it('keeps a wide logo inside the right margin when it replaces the wordmark in an edited design', () => {
    const edited = setLogoSize(defaultHeaderDesign(content(), measure), { height: 40 }, pageW)
    const wide = resolveHeaderDesign(edited, content({ logo: { width: 600, height: 100 } }), measure).fixed.logo
    expect(wide.x + wide.w).toBeLessThanOrEqual(pageW - 29.37 + 0.01)
    expect(aspectOf(wide)).toBeCloseTo(6, 1)
    const huge = resolveHeaderDesign(setLogoSize(edited, { height: 140 }, pageW), content({ logo: { width: 600, height: 100 } }), measure).fixed.logo
    expect(huge.x).toBeGreaterThanOrEqual(0)
    expect(huge.x + huge.w).toBeLessThanOrEqual(pageW - 29.37 + 0.01)
    expect(aspectOf(huge)).toBeCloseTo(6, 1)
  })
})
