import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { AxiosError, AxiosHeaders } from 'axios'
import { HeaderDesignToolbar, VERIFICATION_KEY, VerificationBlock } from '@/features/statement/components/statement-header-designer'
import {
  PAGE,
  PREVIEW_PX,
  adaptHeaderDesign,
  defaultHeaderDesign,
  restoreHeaderDesign,
  serializeHeaderDesign,
  VERIFICATION_DISCLAIMER,
  defaultVerificationText,
  fitVerification,
  fitVerificationCaption,
  moveVerification,
  toVerificationPayload,
  verificationCaption,
  type HeaderDesign,
  type Measure,
} from '@/features/statement/lib/statement-header-layout'
import { formatVerificationCode, normalizeVerificationCode, sha256Hex } from '@/features/statement/lib/statement-verify'

const verificationState = vi.hoisted(() => ({ result: { data: undefined as unknown, isLoading: false, error: null as unknown } }))
vi.mock('@/hooks/useStatement', () => ({ useStatementVerification: () => verificationState.result }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))

const { StatementVerificationResult } = await import('@/features/statement/components/statement-verification')

const measure: Measure = (text, fontSize) => Array.from(text).length * fontSize * 0.5
const design = (): HeaderDesign =>
  defaultHeaderDesign({ title: 'Хуулга', fields: [], logoLines: [], orientation: 'portrait' }, measure)

beforeAll(() => {
  if (!('PointerEvent' in window)) Object.defineProperty(window, 'PointerEvent', { value: MouseEvent, configurable: true })
})

describe('verification block layout', () => {
  it('starts at the left margin under the content with a caption filling the line', () => {
    const v = design().verification
    expect(v).toMatchObject({ x: 20.16, gap: 12, size: 64, fontSize: 6, hidden: false })
    expect(v.x + v.size + 8 + v.w).toBeCloseTo(PAGE.portrait.w - 29.37, 1)
  })

  it('is left out of the payload when hidden and clamped to the server limits otherwise', () => {
    const v = design().verification
    expect(toVerificationPayload({ ...v, hidden: true }, 'portrait')).toBeUndefined()
    expect(toVerificationPayload({ ...v, size: 500, fontSize: 1, gap: -5 }, 'portrait')).toMatchObject({ size: 200, fontSize: 4, gap: 0 })
  })

  it('keeps a left-margin block in place and stretches its caption with the page on orientation change', () => {
    const portrait = design()
    const landscape = adaptHeaderDesign(portrait, 'portrait', 'landscape')
    expect(landscape.verification.x).toBe(portrait.verification.x)
    expect(landscape.verification.w).toBeGreaterThan(portrait.verification.w)
  })

  it('restores a saved block and gives older templates (saved before the QR existed) the default one', () => {
    const custom = { ...design(), verification: { ...design().verification, gap: 40, hidden: true } }
    const saved = JSON.parse(JSON.stringify(serializeHeaderDesign(custom, [])))
    expect(restoreHeaderDesign(saved, [])!.verification).toEqual(custom.verification)
    delete saved.verification
    expect(restoreHeaderDesign(saved, [])!.verification).toEqual(design().verification)
  })
})

describe('VerificationBlock', () => {
  const renderBlock = () => {
    const props = {
      design: design(),
      orientation: 'portrait' as const,
      selected: null,
      onSelect: vi.fn(),
      onChange: vi.fn(),
    }
    render(<VerificationBlock {...props} />)
    return { props, block: screen.getByRole('button', { name: 'Баталгаажуулах QR — чирж байрлуулах' }) }
  }

  it('shows the empty QR and the fixed caption with a placeholder code', () => {
    renderBlock()
    expect(screen.getByText('Баталгаажуулах код: XXXX-XXXX-XXXX-XXXX')).toBeInTheDocument()
    expect(screen.getByText(/https:\/\/itd\.teso\.mn\/verify хаягаар/)).toBeInTheDocument()
    expect(screen.getByText(/албан ёсны баримт биш/)).toBeInTheDocument()
  })

  it('drags horizontally into X and vertically into the gap above it', () => {
    const { props, block } = renderBlock()
    fireEvent.pointerDown(block, { button: 0, clientX: 100, clientY: 100, pointerId: 1 })
    fireEvent.pointerMove(block, { clientX: 100 + 40 * PREVIEW_PX, clientY: 100 + 10 * PREVIEW_PX, pointerId: 1 })
    fireEvent.pointerUp(block, { pointerId: 1 })
    expect(props.onSelect).toHaveBeenCalledWith(VERIFICATION_KEY)
    const next = props.onChange.mock.calls[0]![0].verification
    expect(next.x).toBeCloseTo(props.design.verification.x + 40, 1)
    expect(next.gap).toBeCloseTo(props.design.verification.gap + 10, 1)
  })

  it('nudges with arrows and hides with Delete', () => {
    const { props, block } = renderBlock()
    fireEvent.keyDown(block, { key: 'ArrowDown', shiftKey: true })
    expect(props.onChange.mock.calls[0]![0].verification.gap).toBe(props.design.verification.gap + 10)
    fireEvent.keyDown(block, { key: 'Delete' })
    expect(props.onChange.mock.calls[1]![0].verification.hidden).toBe(true)
  })

  it('edits size from the toolbar and offers to bring a hidden block back', () => {
    const onChange = vi.fn()
    const base = design()
    const { rerender } = render(
      <HeaderDesignToolbar
        design={base}
        orientation="portrait"
        content={{ title: '', fields: [], logoLines: [], periodStart: '', periodEnd: '', printedDate: '' }}
        selected={VERIFICATION_KEY}
        onChange={onChange}
        onAddText={vi.fn()}
        onReset={vi.fn()}
        onRemove={vi.fn()}
      />,
    )
    fireEvent.change(screen.getByRole('spinbutton', { name: 'QR хэмжээ' }), { target: { value: '90' } })
    expect(onChange.mock.calls[0]![0].verification.size).toBe(90)

    rerender(
      <HeaderDesignToolbar
        design={{ ...base, verification: { ...base.verification, hidden: true } }}
        orientation="portrait"
        content={{ title: '', fields: [], logoLines: [], periodStart: '', periodEnd: '', printedDate: '' }}
        selected={null}
        onChange={onChange}
        onAddText={vi.fn()}
        onReset={vi.fn()}
        onRemove={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Баталгаажуулах QR' }))
    expect(onChange.mock.calls.at(-1)![0].verification.hidden).toBe(false)
  })
})

describe('verification page', () => {
  const record = {
    code: 'ABCD-EFGH-JKMN-PQRS',
    title: 'Дансны дэлгэрэнгүй хуулга',
    generatedAt: '2026-11-09T03:00:00.000Z',
    pageCount: 22,
    rowCount: 1127,
    pdfSha256: '',
  }

  beforeEach(() => {
    verificationState.result = { data: undefined, isLoading: false, error: null }
    // Production нь HTTPS — crypto.subtle зөвхөн secure context-д байдаг.
    Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true })
  })

  it('normalises typed codes the same way as the API', () => {
    expect(normalizeVerificationCode('abcd-efgh jkmn-pqrs')).toBe('ABCDEFGHJKMNPQRS')
    expect(normalizeVerificationCode('OOOO-IIII-LLLL-2345')).toBe('0000111111112345')
    expect(formatVerificationCode('ABCDEFGHJKMNPQRS')).toBe('ABCD-EFGH-JKMN-PQRS')
  })

  it('says the record was not found for an unknown code', () => {
    const headers = new AxiosHeaders()
    verificationState.result = {
      data: undefined,
      isLoading: false,
      error: new AxiosError('404', 'ERR', undefined, undefined, { status: 404, data: {}, statusText: '', headers, config: { headers } }),
    }
    render(<StatementVerificationResult code="ABCDEFGHJKMNPQRS" />)
    expect(screen.getByText('Бүртгэл олдсонгүй')).toBeInTheDocument()
  })

  it('rejects a malformed code without calling the API', () => {
    render(<StatementVerificationResult code="nope" />)
    expect(screen.getByText(/Код буруу хэлбэртэй/)).toBeInTheDocument()
  })

  it('shows the record in Ulaanbaatar time with the not-a-bank-document notice and checks a PDF by hash', async () => {
    const pdf = new TextEncoder().encode('%PDF-1.7 test').buffer as ArrayBuffer
    verificationState.result = { data: { ...record, pdfSha256: await sha256Hex(pdf) }, isLoading: false, error: null }
    const { container } = render(<StatementVerificationResult code="ABCD-EFGH-JKMN-PQRS" />)
    expect(screen.getByText('TESO ITAM-д бүртгэлтэй тайлан')).toBeInTheDocument()
    expect(screen.getByText('2026/11/09 11:00')).toBeInTheDocument()
    expect(screen.getByText('1,127')).toBeInTheDocument()
    expect(screen.getByText(/банк болон бусад байгууллагаас гаргасан албан ёсны баримт биш/)).toBeInTheDocument()

    const input = container.querySelector('input[type=file]') as HTMLInputElement
    const file = new File([pdf], 'хуулга.pdf', { type: 'application/pdf' })
    fireEvent.change(input, { target: { files: [file] } })
    await waitFor(() => expect(screen.getByText(/яг таарч байна/)).toBeInTheDocument())

    const edited = new File([new TextEncoder().encode('%PDF-1.7 edited')], 'засварласан.pdf', { type: 'application/pdf' })
    fireEvent.change(input, { target: { files: [edited] } })
    await waitFor(() => expect(screen.getByText(/таарахгүй байна/)).toBeInTheDocument())
  })
})

describe('verification page PDF check robustness', () => {
  const record = {
    code: 'ABCD-EFGH-JKMN-PQRS',
    title: 'Хуулга',
    generatedAt: '2026-11-09T03:00:00.000Z',
    pageCount: 1,
    rowCount: 3,
    pdfSha256: 'a'.repeat(64),
  }

  it('checks a PDF over plain http (no crypto.subtle) with the JS SHA-256', async () => {
    Object.defineProperty(window, 'isSecureContext', { value: false, configurable: true })
    // SHA-256("abc") — FIPS 180-2-ийн жишээ утга.
    const abc = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
    verificationState.result = { data: { ...record, pdfSha256: abc }, isLoading: false, error: null }
    const digest = vi.spyOn(crypto.subtle, 'digest')
    try {
      const { container } = render(<StatementVerificationResult code="ABCDEFGHJKMNPQRS" />)
      expect(screen.queryByText(/HTTPS/)).toBeNull()
      const input = container.querySelector('input[type=file]') as HTMLInputElement
      fireEvent.change(input, { target: { files: [new File(['abc'], 'хуулга.pdf', { type: 'application/pdf' })] } })
      await waitFor(() => expect(screen.getByText(/яг таарч байна/)).toBeInTheDocument())
      expect(digest).not.toHaveBeenCalled()
    } finally {
      digest.mockRestore()
      Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true })
    }
  })

  it('gives the same SHA-256 with and without crypto.subtle', async () => {
    const data = new TextEncoder().encode('%PDF-1.7 TESO хуулга').buffer as ArrayBuffer
    Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true })
    const viaSubtle = await sha256Hex(data)
    Object.defineProperty(window, 'isSecureContext', { value: false, configurable: true })
    const viaJs = await sha256Hex(data)
    Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true })
    expect(viaJs).toBe(viaSubtle)
    expect(await sha256Hex(new TextEncoder().encode('').buffer as ArrayBuffer)).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    )
  })

  it('shows an error instead of spinning forever when hashing fails', async () => {
    Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true })
    verificationState.result = { data: record, isLoading: false, error: null }
    const digest = vi.spyOn(crypto.subtle, 'digest').mockRejectedValueOnce(new Error('boom'))
    try {
      const { container } = render(<StatementVerificationResult code="ABCDEFGHJKMNPQRS" />)
      const input = container.querySelector('input[type=file]') as HTMLInputElement
      fireEvent.change(input, { target: { files: [new File(['%PDF'], 'x.pdf', { type: 'application/pdf' })] } })
      await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('шалгаж чадсангүй'))
    } finally {
      digest.mockRestore()
    }
  })
})

describe('verification block stays on the page', () => {
  const rightEdge = PAGE.portrait.w - 29.37

  it('re-clamps X when the QR grows at the right edge so the caption keeps at least 60pt inside the margin', () => {
    const atRight = moveVerification(design().verification, 1000, 0, 0, 'portrait')
    const grown = fitVerification({ ...atRight, size: 200 }, 'portrait')
    expect(grown.x + grown.size + 8 + grown.w).toBeLessThanOrEqual(rightEdge + 0.01)
    expect(grown.w).toBeGreaterThanOrEqual(60)
    const payload = toVerificationPayload({ ...atRight, size: 200 }, 'portrait')!
    expect(payload.x + payload.size + 8 + payload.w).toBeLessThanOrEqual(rightEdge + 0.01)
  })

  it('applies the clamp when the toolbar changes the QR size', () => {
    const onChange = vi.fn()
    const base = design()
    const atRight = { ...base, verification: moveVerification(base.verification, 1000, 0, 0, 'portrait') }
    render(
      <HeaderDesignToolbar
        design={atRight}
        orientation="portrait"
        content={{ title: '', fields: [], logoLines: [], periodStart: '', periodEnd: '', printedDate: '' }}
        selected={VERIFICATION_KEY}
        onChange={onChange}
        onAddText={vi.fn()}
        onReset={vi.fn()}
        onRemove={vi.fn()}
      />,
    )
    fireEvent.change(screen.getByRole('spinbutton', { name: 'QR хэмжээ' }), { target: { value: '200' } })
    const v = onChange.mock.calls[0]![0].verification
    expect(v.x + v.size + 8 + v.w).toBeLessThanOrEqual(rightEdge + 0.01)
  })
})

describe('editable verification caption', () => {
  const toolbar = (d: HeaderDesign, onChange = vi.fn()) => {
    render(
      <HeaderDesignToolbar
        design={d}
        orientation="portrait"
        content={{ title: '', fields: [], logoLines: [], periodStart: '', periodEnd: '', printedDate: '' }}
        selected={VERIFICATION_KEY}
        onChange={onChange}
        onAddText={vi.fn()}
        onReset={vi.fn()}
        onRemove={vi.fn()}
      />,
    )
    return onChange
  }

  it('matches the API default text word for word and keeps the code line and disclaimer around any text', () => {
    // API-ийн DEFAULT_VERIFICATION_TEXT-тэй ижил; {хаяг}-ийг сервер PUBLIC_WEB_URL-ийн шалгах хаягаар солино.
    expect(defaultVerificationText()).toBe(
      'Энэхүү тайланг TESO ITAM системд үүсгэсэн. QR кодыг уншуулах эсвэл {хаяг} хаягаар орж кодыг оруулан бүртгэлийг шалгана уу.\n' +
        'Шалгах хуудсанд PDF файлаа оруулбал үүсгэснээс хойш өөрчлөгдөөгүй эсэхийг тулгана.',
    )
    expect(verificationCaption('XXXX', defaultVerificationText())[1]).toContain('https://itd.teso.mn/verify хаягаар')
    expect(verificationCaption('XXXX', 'Утас:     7700  1234')[1]).toBe('Утас: 7700 1234')
    expect(VERIFICATION_DISCLAIMER).toBe('Энэ нь TESO ITAM-ын дотоод тайлан бөгөөд банк болон бусад байгууллагаас гаргасан албан ёсны баримт биш.')
    expect(design().verification.text).toBe(defaultVerificationText())
    expect(verificationCaption('XXXX', '  Нэгдүгээр мөр\r\n\n\tХоёрдугаар мөр ')).toEqual([
      'Баталгаажуулах код: XXXX',
      'Нэгдүгээр мөр',
      'Хоёрдугаар мөр',
      VERIFICATION_DISCLAIMER,
    ])
    expect(verificationCaption('XXXX', '')).toEqual(['Баталгаажуулах код: XXXX', VERIFICATION_DISCLAIMER])
  })

  it('edits the caption from the QR options and resets it to the default text', () => {
    const base = design()
    const onChange = toolbar(base)
    expect(screen.getByRole('button', { name: /Анхны текст/ })).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Тайлбарын текст'), { target: { value: 'Санхүүгийн алба\nУтас: 7700-1234' } })
    expect(onChange.mock.calls[0]![0].verification.text).toBe('Санхүүгийн алба\nУтас: 7700-1234')
    cleanup()

    const edited = { ...base, verification: { ...base.verification, text: 'Өөр текст' } }
    const reset = toolbar(edited)
    fireEvent.click(screen.getByRole('button', { name: /Анхны текст/ }))
    expect(reset.mock.calls[0]![0].verification.text).toBe(defaultVerificationText())
  })

  it('warns that lines past the twentieth are dropped and sends only what the server accepts (20 lines, 1000 chars)', () => {
    const base = design()
    const lines = Array.from({ length: 22 }, (_, i) => `Мөр ${i + 1}`)
    const v = { ...base.verification, text: lines.join('\n\n') }
    toolbar({ ...base, verification: v })
    expect(screen.getByText('22/20 мөр', { exact: false })).toBeInTheDocument()
    expect(screen.getByText('Эхний 20 мөр л хэвлэгдэнэ.')).toBeInTheDocument()
    expect(toVerificationPayload(v, 'portrait')!.text).toBe(lines.slice(0, 20).join('\n'))
    expect(toVerificationPayload({ ...v, text: 'а'.repeat(1200) }, 'portrait')!.text).toHaveLength(1000)
    expect(toVerificationPayload({ ...v, text: 'а'.repeat(900) }, 'portrait')!.text).toHaveLength(900)
  })

  it('shows the custom text in the preview and survives a save/restore, while older saves get the default text', () => {
    const custom = { ...design(), verification: { ...design().verification, text: 'Дотоод хэрэгцээнд' } }
    render(<VerificationBlock design={custom} orientation="portrait" selected={null} onSelect={vi.fn()} onChange={vi.fn()} />)
    expect(screen.getByText('Дотоод хэрэгцээнд')).toBeInTheDocument()
    expect(screen.queryByText(/QR кодыг уншуулах/)).toBeNull()
    expect(screen.getByText(VERIFICATION_DISCLAIMER)).toBeInTheDocument()

    const saved = JSON.parse(JSON.stringify(serializeHeaderDesign(custom, [])))
    expect(restoreHeaderDesign(saved, [])!.verification.text).toBe('Дотоод хэрэгцээнд')
    delete saved.verification.text
    expect(restoreHeaderDesign(saved, [])!.verification.text).toBe(defaultVerificationText())
  })
})

describe('caption fits one page like the PDF', () => {
  it('widens, then shrinks the font, then clips only the user text — the code line and disclaimer always stay', () => {
    const base = design().verification
    const long = Array.from({ length: 8 }, (_, i) => `${i + 1}. ` + 'Санхүүгийн албаны дотоод хэрэгцээнд зориулсан тайлбар '.repeat(2)).join('\n')
    const narrow = { ...base, w: 150, fontSize: 14, text: long }
    const widened = fitVerificationCaption(narrow, 'portrait', measure)
    expect(widened.adjusted).toBe(true)
    expect(widened.captionW).toBeGreaterThan(150)

    const wide = { ...base, x: 1000, size: 40, w: 60, fontSize: 14, text: Array.from({ length: 8 }, () => 'Ш'.repeat(74)).join('\n') }
    // ⸻ мэт өргөн тэмдэгт (2.84em) — 4pt-д ч нэг хуудсанд багтахгүй.
    const wideMeasure: Measure = (text, fontSize) => Array.from(text).reduce((w, ch) => w + fontSize * (ch === 'Ш' ? 2.84 : 0.5), 0)
    const clipped = fitVerificationCaption(wide, 'landscape', wideMeasure)
    expect(clipped.clipped).toBe(true)
    expect(clipped.fontSize).toBe(4)
    expect(clipped.paragraphs[0]).toEqual({ text: 'Баталгаажуулах код: XXXX-XXXX-XXXX-XXXX', kept: null })
    expect(clipped.paragraphs.at(-1)).toEqual({ text: VERIFICATION_DISCLAIMER, kept: null })
    expect(clipped.paragraphs.some((p) => p.kept !== null)).toBe(true)

    const normal = fitVerificationCaption(base, 'portrait', measure)
    expect(normal).toMatchObject({ adjusted: false, clipped: false, captionW: base.w, fontSize: base.fontSize })
  })

  it('tells the user when the PDF will print the caption wider or smaller than set', () => {
    const base = design()
    const long = Array.from({ length: 8 }, (_, i) => `${i + 1}. ` + 'Санхүүгийн албаны дотоод хэрэгцээнд зориулсан тайлбар '.repeat(2))
    render(
      <HeaderDesignToolbar
        design={{ ...base, verification: { ...base.verification, w: 150, fontSize: 14, text: long.join('\n') } }}
        orientation="portrait"
        content={{ title: '', fields: [], logoLines: [], periodStart: '', periodEnd: '', printedDate: '' }}
        selected={VERIFICATION_KEY}
        onChange={vi.fn()}
        onAddText={vi.fn()}
        onReset={vi.fn()}
        onRemove={vi.fn()}
      />,
    )
    expect(screen.getByRole('status')).toHaveTextContent('нэг хуудсанд багтахгүй')
  })

  it('associates the counter and hints with the caption textarea for screen readers', () => {
    const base = design()
    render(
      <HeaderDesignToolbar
        design={{ ...base, verification: { ...base.verification, text: Array.from({ length: 21 }, (_, i) => `Мөр ${i}`).join('\n') } }}
        orientation="portrait"
        content={{ title: '', fields: [], logoLines: [], periodStart: '', periodEnd: '', printedDate: '' }}
        selected={VERIFICATION_KEY}
        onChange={vi.fn()}
        onAddText={vi.fn()}
        onReset={vi.fn()}
        onRemove={vi.fn()}
      />,
    )
    const textarea = screen.getByLabelText('Тайлбарын текст')
    expect(textarea).toHaveAttribute('aria-invalid', 'true')
    expect(textarea).toHaveAccessibleDescription(/21\/20 мөр/)
    expect(textarea).toHaveAccessibleDescription(/Эхний 20 мөр л хэвлэгдэнэ/)
  })
})
