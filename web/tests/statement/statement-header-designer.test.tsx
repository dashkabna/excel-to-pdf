import { useState } from 'react'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { HeaderDesignBand, HeaderDesignToolbar, type HeaderDesignContent } from '@/features/statement/components/statement-header-designer'
import { LOGO_HEIGHT_RATIO, PREVIEW_PX, defaultHeaderDesign, type HeaderDesign, type Measure } from '@/features/statement/lib/statement-header-layout'

const measure: Measure = (text, fontSize) => Array.from(text).length * fontSize * 0.5

const content: HeaderDesignContent = {
  title: 'Дансны дэлгэрэнгүй хуулга',
  fields: [{ id: 'a', label: 'Харилцагчийн нэр', value: 'Тест' }],
  logoLines: ['УЛААНБААТАР ХОТ'],
  periodStart: '10/09/2025',
  periodEnd: '10/28/2026',
  printedDate: '2026/11/09',
}

const design = (): HeaderDesign =>
  defaultHeaderDesign({ title: content.title, fields: content.fields, logoLines: content.logoLines, orientation: 'portrait' }, measure)

beforeAll(() => {
  // jsdom-д PointerEvent байхгүй — clientX/clientY-тай MouseEvent хангалттай.
  if (!('PointerEvent' in window)) {
    Object.defineProperty(window, 'PointerEvent', { value: MouseEvent, configurable: true })
  }
})

const renderBand = () => {
  const props = {
    design: design(),
    orientation: 'portrait' as const,
    content,
    selected: null,
    onSelect: vi.fn(),
    onChange: vi.fn(),
    onRemove: vi.fn(),
  }
  render(<HeaderDesignBand {...props} />)
  return props
}

describe('HeaderDesignBand', () => {
  it('renders every header element as a draggable control with the live content', () => {
    renderBand()
    for (const name of ['Гарчиг', 'Лого', 'Логоны доорх мэдээлэл', 'Эхлэх огноо', 'Дуусах огноо', 'Одоогийн огноо', 'Талбар: Харилцагчийн нэр']) {
      expect(screen.getByRole('button', { name: `${name} — чирж байрлуулах` })).toBeInTheDocument()
    }
    expect(screen.getByText('Эхлэх огноо: 10/09/2025')).toBeInTheDocument()
    expect(screen.getByText('Харилцагчийн нэр:')).toBeInTheDocument()
  })

  it('nudges the focused element with arrow keys (Shift = 10pt) and removes it with Delete', () => {
    const props = renderBand()
    const title = screen.getByRole('button', { name: 'Гарчиг — чирж байрлуулах' })
    const start = props.design.fixed.title

    fireEvent.keyDown(title, { key: 'ArrowRight' })
    expect(props.onChange).toHaveBeenLastCalledWith(expect.objectContaining({ fixed: expect.objectContaining({ title: expect.objectContaining({ x: start.x + 1, y: start.y }) }) }))

    fireEvent.keyDown(title, { key: 'ArrowUp', shiftKey: true })
    expect(props.onChange.mock.calls.at(-1)![0].fixed.title.y).toBeCloseTo(start.y - 10, 2)

    fireEvent.keyDown(title, { key: 'Delete' })
    expect(props.onRemove).toHaveBeenCalledWith('fixed:title')
  })

  it('moves an element by dragging and commits once on release', () => {
    const props = renderBand()
    const field = screen.getByRole('button', { name: 'Талбар: Харилцагчийн нэр — чирж байрлуулах' })
    fireEvent.pointerDown(field, { button: 0, clientX: 100, clientY: 50, pointerId: 1 })
    fireEvent.pointerMove(field, { clientX: 100 + 30 * PREVIEW_PX, clientY: 50 + 4 * PREVIEW_PX, pointerId: 1 })
    expect(props.onChange).not.toHaveBeenCalled()
    fireEvent.pointerUp(field, { clientX: 100 + 30 * PREVIEW_PX, clientY: 50 + 4 * PREVIEW_PX, pointerId: 1 })

    expect(props.onSelect).toHaveBeenCalledWith('field:a')
    expect(props.onChange).toHaveBeenCalledTimes(1)
    const moved = props.onChange.mock.calls[0]![0].fields.a
    expect(moved.x).toBeCloseTo(props.design.fields.a!.x + 30, 1)
    expect(moved.y).toBeCloseTo(props.design.fields.a!.y + 4, 1)
  })

  it('treats a click without movement as selection only', () => {
    const props = renderBand()
    const logo = screen.getByRole('button', { name: 'Лого — чирж байрлуулах' })
    fireEvent.pointerDown(logo, { button: 0, clientX: 10, clientY: 10, pointerId: 1 })
    fireEvent.pointerUp(logo, { clientX: 10, clientY: 10, pointerId: 1 })
    expect(props.onSelect).toHaveBeenCalledWith('fixed:logo')
    expect(props.onChange).not.toHaveBeenCalled()
  })

  it('moves the table start line with the keyboard', () => {
    const props = renderBand()
    const line = screen.getByRole('separator', { name: /Хүснэгт эхлэх шугам/ })
    fireEvent.keyDown(line, { key: 'ArrowDown', shiftKey: true })
    expect(props.onChange.mock.calls[0]![0].bandHeight).toBeCloseTo(props.design.bandHeight + 10, 2)
  })
})

describe('HeaderDesignToolbar', () => {
  it('edits the selected element and hides fixed elements instead of deleting them', () => {
    const onChange = vi.fn()
    const onRemove = vi.fn()
    const base = design()
    render(
      <HeaderDesignToolbar
        design={base}
        orientation="portrait"
        content={content}
        selected="fixed:title"
        onChange={onChange}
        onAddText={vi.fn()}
        onReset={vi.fn()}
        onRemove={onRemove}
      />,
    )
    const size = screen.getByRole('spinbutton', { name: 'Үсэг' })
    // "14" бичих үед эхний "1" доод хязгаараас бага тул хэрэглэгдэхгүй, элемент үсрэхгүй.
    fireEvent.change(size, { target: { value: '1' } })
    expect(onChange).not.toHaveBeenCalled()
    fireEvent.change(size, { target: { value: '14' } })
    const title = onChange.mock.calls[0]![0].fixed.title
    expect(title.fontSize).toBe(14)
    // Хайрцаг үсэгтэйгээ хамт томорно.
    expect(title.w).toBeCloseTo((base.fixed.title.w * 14) / base.fixed.title.fontSize, 2)

    fireEvent.click(screen.getByRole('button', { name: 'Баруун' }))
    expect(onChange.mock.calls[1]![0].fixed.title.align).toBe('right')

    fireEvent.click(screen.getByRole('button', { name: /Нуух/ }))
    expect(onRemove).toHaveBeenCalledWith('fixed:title')
  })

  it('offers to bring back hidden elements', () => {
    const onChange = vi.fn()
    const base = design()
    base.fixed.logoLines.hidden = true
    render(
      <HeaderDesignToolbar
        design={base}
        orientation="portrait"
        content={content}
        selected={null}
        onChange={onChange}
        onAddText={vi.fn()}
        onReset={vi.fn()}
        onRemove={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Логоны доорх мэдээлэл' }))
    expect(onChange.mock.calls[0]![0].fixed.logoLines.hidden).toBe(false)
  })
})

describe('review regressions', () => {
  it('focuses the clicked element so the keyboard acts on it, not on a previously focused one', () => {
    const props = renderBand()
    const field = screen.getByRole('button', { name: 'Талбар: Харилцагчийн нэр — чирж байрлуулах' })
    const title = screen.getByRole('button', { name: 'Гарчиг — чирж байрлуулах' })
    field.focus()
    fireEvent.pointerDown(title, { button: 0, clientX: 5, clientY: 5, pointerId: 1 })
    fireEvent.pointerUp(title, { clientX: 5, clientY: 5, pointerId: 1 })
    expect(document.activeElement).toBe(title)
    fireEvent.keyDown(document.activeElement!, { key: 'Delete' })
    expect(props.onRemove).toHaveBeenCalledWith('fixed:title')
    expect(props.onRemove).not.toHaveBeenCalledWith('field:a')
  })

  it('drops a pending number draft when the value changes elsewhere or another element is selected', () => {
    const onChange = vi.fn()
    const base = design()
    const toolbar = (d: HeaderDesign, selected: 'fixed:title' | 'fixed:logo') => (
      <HeaderDesignToolbar
        design={d}
        orientation="portrait"
        content={content}
        selected={selected}
        onChange={onChange}
        onAddText={vi.fn()}
        onReset={vi.fn()}
        onRemove={vi.fn()}
      />
    )
    const { rerender } = render(toolbar(base, 'fixed:title'))
    const x = screen.getByRole('spinbutton', { name: 'X' })
    fireEvent.change(x, { target: { value: '100' } })
    expect(onChange.mock.calls[0]![0].fixed.title.x).toBe(100)

    // Элементийг чирсэн мэт гаднаас x өөрчлөгдөнө — оролт шинэ утгыг харуулж, blur хуучныг буцааж бичихгүй.
    const dragged = { ...base, fixed: { ...base.fixed, title: { ...base.fixed.title, x: 300 } } }
    rerender(toolbar(dragged, 'fixed:title'))
    expect(screen.getByRole('spinbutton', { name: 'X' })).toHaveValue(300)
    fireEvent.blur(screen.getByRole('spinbutton', { name: 'X' }))
    expect(onChange).toHaveBeenCalledTimes(1)

    rerender(toolbar(dragged, 'fixed:logo'))
    expect(screen.getByRole('spinbutton', { name: 'X' })).toHaveValue(dragged.fixed.logo.x)
  })

  it('grows the band when an element would end below the table line', () => {
    const base = design()
    const low = { ...base, fixed: { ...base.fixed, title: { ...base.fixed.title, y: base.bandHeight - 2 } } }
    const onChange = vi.fn()
    render(
      <HeaderDesignBand
        design={low}
        orientation="portrait"
        content={content}
        selected={null}
        onSelect={vi.fn()}
        onChange={onChange}
        onRemove={vi.fn()}
      />,
    )
    const next = onChange.mock.calls.at(-1)![0] as HeaderDesign
    expect(next.bandHeight).toBeGreaterThanOrEqual(low.fixed.title.y + 11.7 * 1.149 - 0.01)
    expect(next.fixed.title.y).toBe(low.fixed.title.y)
  })
})

describe('uploaded logo', () => {
  const logo = { src: 'data:image/png;base64,iVBORw0KGgo=', width: 400, height: 100 }

  it('sizes the default logo box like the server: the image fits 124×26', () => {
    const d = defaultHeaderDesign(
      { title: content.title, fields: content.fields, logoLines: [], orientation: 'portrait', logo: { width: 400, height: 100 } },
      measure,
    )
    expect(d.fixed.logo.w).toBeCloseTo(104, 1)
    expect(d.fixed.logo.x + d.fixed.logo.w).toBeCloseTo(595.28 - 29.37, 1)
  })

  it('draws the image scaled to the box instead of the TESO wordmark', () => {
    const base = design()
    render(
      <HeaderDesignBand
        design={{ ...base, fixed: { ...base.fixed, logo: { ...base.fixed.logo, w: 200, fontSize: 22 } } }}
        orientation="portrait"
        content={content}
        logo={logo}
        selected={null}
        onSelect={vi.fn()}
        onChange={vi.fn()}
        onRemove={vi.fn()}
      />,
    )
    const img = screen.getByRole('img', { name: 'Байгууллагын лого' })
    // Хайрцаг 200 × 26pt: 400×100 зураг өндрөөрөө (26/100) багтана → 104 × 26pt.
    expect(img).toHaveStyle({ width: `${(104 * PREVIEW_PX).toFixed(2)}px`, height: `${(26 * PREVIEW_PX).toFixed(2)}px` })
    expect(screen.queryByText('TESO')).toBeNull()
  })
})

describe('resizable logo', () => {
  const logo = { src: 'data:image/png;base64,iVBORw0KGgo=', width: 400, height: 100 }
  const withLogo = () =>
    defaultHeaderDesign(
      { title: content.title, fields: content.fields, logoLines: [], orientation: 'portrait', logo: { width: 400, height: 100 } },
      measure,
    )

  const renderSelected = (d: HeaderDesign) => {
    const props = { onSelect: vi.fn(), onChange: vi.fn(), onRemove: vi.fn() }
    const { container } = render(
      <HeaderDesignBand design={d} orientation="portrait" content={content} logo={logo} selected="fixed:logo" {...props} />,
    )
    return { ...props, container }
  }

  it('shows corner handles instead of the width handle on the selected logo', () => {
    const { container } = renderSelected(withLogo())
    expect(container.querySelectorAll('[data-logo-corner]')).toHaveLength(2)
    expect(container.querySelector('.cursor-ew-resize')).toBeNull()
  })

  it('enlarges the logo with its aspect kept when the bottom-left corner is dragged out, keeping the right edge', () => {
    const d = withLogo()
    const box = d.fixed.logo
    const { container, onChange } = renderSelected(d)
    const corner = container.querySelector('[data-logo-corner="left"]')!
    fireEvent.pointerDown(corner, { button: 0, clientX: 300, clientY: 100, pointerId: 1 })
    fireEvent.pointerMove(corner, { clientX: 300 - 52 * PREVIEW_PX, clientY: 100 + 13 * PREVIEW_PX, pointerId: 1 })
    fireEvent.pointerUp(corner, { clientX: 300 - 52 * PREVIEW_PX, clientY: 100 + 13 * PREVIEW_PX, pointerId: 1 })

    expect(onChange).toHaveBeenCalledTimes(1)
    const next = (onChange.mock.calls[0]![0] as HeaderDesign).fixed.logo
    expect(next.w).toBeCloseTo(box.w * 1.5, 0)
    expect(next.fontSize).toBeCloseTo(box.fontSize * 1.5, 0)
    expect(next.x + next.w).toBeCloseTo(box.x + box.w, 1)
    expect(next.y).toBe(box.y)
  })

  it('edits the logo height in pt from the toolbar, with the width following the aspect', () => {
    const d = withLogo()
    const onChange = vi.fn()
    render(
      <HeaderDesignToolbar
        design={d}
        orientation="portrait"
        content={content}
        selected="fixed:logo"
        onChange={onChange}
        onAddText={vi.fn()}
        onReset={vi.fn()}
        onRemove={vi.fn()}
      />,
    )
    const height = screen.getByRole('spinbutton', { name: 'Өндөр' })
    expect(height).toHaveValue(26)
    fireEvent.change(height, { target: { value: '52' } })
    const next = onChange.mock.calls[0]![0].fixed.logo
    expect(next.fontSize * LOGO_HEIGHT_RATIO).toBeCloseTo(52, 1)
    expect(next.w).toBeCloseTo(d.fixed.logo.w * 2, 1)
    // Баруун дээд буланд байгаа лого баруун ирмэгээрээ бэхлэгдэж зүүн тийш томорно — хэлбэр алдагдахгүй.
    expect(next.x + next.w).toBeCloseTo(d.fixed.logo.x + d.fixed.logo.w, 1)
    // 32-оос том хэмжээ логод зөвшөөрөгдөнө (≈142pt өндөр хүртэл).
    fireEvent.change(height, { target: { value: '140' } })
    expect(onChange.mock.calls.at(-1)![0].fixed.logo.fontSize * LOGO_HEIGHT_RATIO).toBeCloseTo(140, 2)
  })
})

describe('logo height field keeps what the user types', () => {
  it('does not rewrite 30 as 29.99 while typing 30.5 (the stored size is rounded to 0.01)', () => {
    const initial = defaultHeaderDesign(
      { title: content.title, fields: content.fields, logoLines: [], orientation: 'portrait', logo: { width: 400, height: 100 } },
      measure,
    )
    let latest = initial
    function Stateful() {
      const [d, setD] = useState(initial)
      return (
        <HeaderDesignToolbar
          design={d}
          orientation="portrait"
          content={content}
          selected="fixed:logo"
          onChange={(next) => {
            latest = next
            setD(next)
          }}
          onAddText={vi.fn()}
          onReset={vi.fn()}
          onRemove={vi.fn()}
        />
      )
    }
    render(<Stateful />)
    const field = screen.getByRole('spinbutton', { name: 'Өндөр' })
    fireEvent.change(field, { target: { value: '30' } })
    expect(field).toHaveValue(30)
    fireEvent.change(field, { target: { value: '30.5' } })
    expect(field).toHaveValue(30.5)
    fireEvent.blur(field)
    expect(latest.fixed.logo.fontSize * LOGO_HEIGHT_RATIO).toBeCloseTo(30.5, 1)
  })
})

describe('logo size fields ignore half-typed values (second review)', () => {
  const statefulToolbar = (initial: HeaderDesign) => {
    const state = { latest: initial }
    function Stateful() {
      const [d, setD] = useState(initial)
      return (
        <HeaderDesignToolbar
          design={d}
          orientation="portrait"
          content={content}
          selected="fixed:logo"
          onChange={(next) => {
            state.latest = next
            setD(next)
          }}
          onAddText={vi.fn()}
          onReset={vi.fn()}
          onRemove={vi.fn()}
        />
      )
    }
    render(<Stateful />)
    return state
  }
  const typeDigits = (field: HTMLElement, value: string) => {
    for (let i = 1; i <= value.length; i++) fireEvent.change(field, { target: { value: value.slice(0, i) } })
    fireEvent.blur(field)
  }
  const logoDesign = (w: number, h: number) =>
    defaultHeaderDesign({ title: content.title, fields: content.fields, logoLines: [], orientation: 'portrait', logo: { width: w, height: h } }, measure)

  it('types a width of 100 without collapsing the logo at "1" or "10"', () => {
    const state = statefulToolbar(logoDesign(400, 100))
    typeDigits(screen.getByRole('spinbutton', { name: 'Өргөн' }), '100')
    expect(state.latest.fixed.logo.w).toBeCloseTo(100, 1)
    expect(state.latest.fixed.logo.fontSize * LOGO_HEIGHT_RATIO).toBeCloseTo(25, 1)
  })

  it('types a height of 50 on a square logo and gets 50', () => {
    const state = statefulToolbar(logoDesign(200, 200))
    typeDigits(screen.getByRole('spinbutton', { name: 'Өндөр' }), '50')
    expect(state.latest.fixed.logo.fontSize * LOGO_HEIGHT_RATIO).toBeCloseTo(50, 1)
    // "5" дамжсан ч хайрцаг зургийн хэлбэрээ (1:1) хадгална.
    expect(state.latest.fixed.logo.w).toBeCloseTo(50, 0)
  })
})
