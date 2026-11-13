import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { HeaderDesignToolbar, VERIFICATION_KEY, VerificationBlock } from '@/features/statement/components/statement-header-designer'
import { StatementPreview } from '@/features/statement/components/statement-preview'
import {
  DEFAULT_QR_LINK,
  VERIFICATION_BASE_URL,
  VERIFICATION_LIMITS,
  defaultHeaderDesign,
  defaultVerificationText,
  normalizeFooterText,
  qrAddress,
  qrLinkError,
  restoreHeaderDesign,
  serializeHeaderDesign,
  toVerificationPayload,
  verificationCaption,
  type HeaderDesign,
  type Measure,
} from '@/features/statement/lib/statement-header-layout'
import type { StatementReportPayload } from '@/lib/api/statement.api'

const measure: Measure = (text, fontSize) => Array.from(text).length * fontSize * 0.5
const design = (): HeaderDesign => defaultHeaderDesign({ title: 'Хуулга', fields: [], logoLines: [], orientation: 'portrait' }, measure)
const HOSTS = ['teso.mn']

describe('qrLinkError (same rules as the API)', () => {
  it('accepts https links on the allowed domain or its subdomains, with or without the {код} token', () => {
    expect(qrLinkError(DEFAULT_QR_LINK, HOSTS)).toBeNull()
    expect(qrLinkError('https://teso.mn/verify/{код}', HOSTS)).toBeNull()
    expect(qrLinkError('https://statement.teso.mn/check?code={код}', HOSTS)).toBeNull()
    expect(qrLinkError('  https://TESO.MN/about  ', HOSTS)).toBeNull()
    expect(qrLinkError('https://a.example.org/x/{код}', ['example.org', 'teso.mn'])).toBeNull()
  })

  it('rejects empty, too long, unparsable, non-https, credential-bearing and look-alike links', () => {
    expect(qrLinkError('   ', HOSTS)).toBe('QR холбоос оруулна уу')
    expect(qrLinkError(`https://teso.mn/${'a'.repeat(300)}`, HOSTS)).toBe('QR холбоос 300 тэмдэгтээс хэтэрсэн')
    expect(qrLinkError('teso.mn/verify/{код}', HOSTS)).toBe('QR холбоос буруу байна')
    expect(qrLinkError('http://itd.teso.mn/verify/{код}', HOSTS)).toBe('QR холбоос https:// хаягаар эхлэх ёстой')
    expect(qrLinkError('https://user:pass@itd.teso.mn/verify/{код}', HOSTS)).toBe('QR холбоос буруу байна')
    expect(qrLinkError('https://teso.mn.evil.com/verify/{код}', HOSTS)).toBe('QR холбоос зөвхөн teso.mn домэйн дээрх хаяг байна')
    expect(qrLinkError('https://evilteso.mn/verify/{код}', HOSTS)).toBe('QR холбоос зөвхөн teso.mn домэйн дээрх хаяг байна')
    expect(qrLinkError('https://example.com/{код}', ['teso.mn', 'teso.com'])).toBe('QR холбоос зөвхөн teso.mn, teso.com домэйн дээрх хаяг байна')
  })
})

describe('qrAddress and the caption {хаяг} token', () => {
  it('drops the code token and the query, and falls back to the default address for an invalid link', () => {
    expect(qrAddress(DEFAULT_QR_LINK)).toBe('https://itd.teso.mn/verify')
    expect(qrAddress('https://statement.teso.mn/check?code={код}')).toBe('https://statement.teso.mn/check')
    expect(qrAddress('https://teso.mn/')).toBe('https://teso.mn')
    expect(qrAddress('not a url')).toBe(VERIFICATION_BASE_URL)
  })

  it('fills {хаяг} in the caption from the QR link', () => {
    expect(verificationCaption('XXXX', defaultVerificationText(), 'https://statement.teso.mn/v/{код}')[1]).toContain(
      'https://statement.teso.mn/v хаягаар',
    )
    expect(verificationCaption('XXXX', defaultVerificationText())[1]).toContain('https://itd.teso.mn/verify хаягаар')
  })

  it('shows the link-derived address in the preview block', () => {
    const base = design()
    render(
      <VerificationBlock
        design={{ ...base, verification: { ...base.verification, link: 'https://statement.teso.mn/v/{код}' } }}
        orientation="portrait"
        selected={null}
        onSelect={vi.fn()}
        onChange={vi.fn()}
      />,
    )
    expect(screen.getByText(/https:\/\/statement\.teso\.mn\/v хаягаар/)).toBeInTheDocument()
  })
})

describe('QR link in the payload and saved designs', () => {
  it('defaults to the itd.teso.mn link, trims and caps it at 300, and survives a save/restore', () => {
    const v = design().verification
    expect(v.link).toBe(DEFAULT_QR_LINK)
    expect(toVerificationPayload({ ...v, link: '  https://teso.mn/{код}  ' }, 'portrait')!.link).toBe('https://teso.mn/{код}')
    expect(toVerificationPayload({ ...v, link: `https://teso.mn/${'a'.repeat(400)}` }, 'portrait')!.link).toHaveLength(VERIFICATION_LIMITS.linkChars)

    const custom = { ...design(), verification: { ...v, link: 'https://statement.teso.mn/v/{код}' } }
    const saved = JSON.parse(JSON.stringify(serializeHeaderDesign(custom, [])))
    expect(restoreHeaderDesign(saved, [])!.verification.link).toBe('https://statement.teso.mn/v/{код}')
    delete saved.verification.link
    expect(restoreHeaderDesign(saved, [])!.verification.link).toBe(DEFAULT_QR_LINK)
  })
})

describe('QR link field in the toolbar', () => {
  const toolbar = (d: HeaderDesign, hosts?: string[]) => {
    const onChange = vi.fn()
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
        qrAllowedHosts={hosts}
      />,
    )
    return onChange
  }

  it('edits the link, resets it, and lists the allowed domains', () => {
    const base = design()
    const onChange = toolbar(base, ['teso.mn', 'teso.com'])
    const input = screen.getByLabelText('QR холбоос')
    expect(input).toHaveValue(DEFAULT_QR_LINK)
    expect(screen.getByRole('button', { name: /Анхны холбоос/ })).toBeDisabled()
    expect(input).toHaveAccessibleDescription(/teso\.mn, teso\.com/)
    fireEvent.change(input, { target: { value: 'https://statement.teso.mn/v/{код}' } })
    expect(onChange.mock.calls[0]![0].verification.link).toBe('https://statement.teso.mn/v/{код}')
  })

  it('shows an inline error for a link outside the allowed domains', () => {
    const base = design()
    const onChange = toolbar({ ...base, verification: { ...base.verification, link: 'https://evil.example/{код}' } })
    const input = screen.getByLabelText('QR холбоос')
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByRole('alert')).toHaveTextContent('QR холбоос зөвхөн teso.mn домэйн дээрх хаяг байна')
    fireEvent.click(screen.getByRole('button', { name: /Анхны холбоос/ }))
    expect(onChange.mock.calls.at(-1)![0].verification.link).toBe(DEFAULT_QR_LINK)
  })
})

describe('footer text', () => {
  it('normalises to one line like the API', () => {
    expect(normalizeFooterText('  Санхүүгийн\tалба\r\nУтас:   7700\u0000-1234\uD800  ')).toBe('Санхүүгийн алба Утас: 7700-1234')
    expect(normalizeFooterText('a b\u0085c')).toBe('a b c')
    expect(normalizeFooterText('   ')).toBe('')
  })

  it('shows the note above the fixed provenance line in the preview, and nothing extra when empty', () => {
    const payload = {
      title: 'Хуулга',
      headerFields: [],
      logoLines: [],
      periodStart: '',
      periodEnd: '',
      orientation: 'portrait',
      columns: [{ label: 'A', align: 'left', width: 1 }],
      rows: [['1']],
      beforeRows: [],
      afterRows: [],
      sourceFileName: 'x.xlsx',
      logoSha256: null,
      footerText: 'Санхүүгийн алба',
    } satisfies StatementReportPayload
    const { rerender } = render(<StatementPreview payload={payload} footer="Энэхүү тайланг ... үүсгэв." footerNote="Санхүүгийн алба" header={null} />)
    expect(screen.getByTestId('statement-footer-note')).toHaveTextContent('Санхүүгийн алба')
    expect(screen.getByText('Энэхүү тайланг ... үүсгэв.')).toBeInTheDocument()
    rerender(<StatementPreview payload={payload} footer="Энэхүү тайланг ... үүсгэв." footerNote="" header={null} />)
    expect(screen.queryByTestId('statement-footer-note')).toBeNull()
  })
})
