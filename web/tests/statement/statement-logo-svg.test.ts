import { afterEach, describe, expect, it, vi } from 'vitest'
import { SvgLogoError, fitSide, isSvgFile, prepareSvgLogo, rasterizeSvgLogo } from '@/features/statement/lib/statement-logo-svg'

const svg = (attrs: string, body = '<rect width="10" height="10"/>') => `<svg xmlns="http://www.w3.org/2000/svg" ${attrs}>${body}</svg>`
const rootOf = (text: string) => new DOMParser().parseFromString(text, 'image/svg+xml').documentElement
const PIXEL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

describe('prepareSvgLogo', () => {
  it('takes the shape from the viewBox and renders at the requested pixel size', () => {
    const prepared = prepareSvgLogo(svg('viewBox="0 0 400 100"'))
    expect(prepared.aspect).toBe(4)
    const root = rootOf(prepared.at(2000, 500))
    expect(root.getAttribute('width')).toBe('2000')
    expect(root.getAttribute('height')).toBe('500')
    expect(root.getAttribute('viewBox')).toBe('0 0 400 100')
  })

  it('prefers absolute width/height (with units) over the viewBox, like an <img> would show it', () => {
    expect(prepareSvgLogo(svg('width="60mm" height="20mm" viewBox="0 0 100 100"')).aspect).toBeCloseTo(3, 5)
    expect(prepareSvgLogo(svg('width="100%" height="100%" viewBox="0 0 300 100"')).aspect).toBe(3)
  })

  it('adds a viewBox from width/height so the drawing scales, and drops root x/y (they would shift a nested crop)', () => {
    const prepared = prepareSvgLogo(svg('width="1in" height="48pt" x="10" y="5"'))
    expect(prepared.aspect).toBeCloseTo(96 / 64, 5)
    const root = rootOf(prepared.at(300, 200))
    expect(root.getAttribute('viewBox')).toBe('0 0 96 64')
    expect(root.hasAttribute('x')).toBe(false)
    expect(root.hasAttribute('y')).toBe(false)
  })

  it('rejects broken files, non-SVG XML and SVGs without any size', () => {
    expect(() => prepareSvgLogo('<svg xmlns="http://www.w3.org/2000/svg"><rect></svg>')).toThrow(SvgLogoError)
    expect(() => prepareSvgLogo('<html xmlns="http://www.w3.org/1999/xhtml"></html>')).toThrow('SVG биш')
    expect(() => prepareSvgLogo('<svg viewBox="0 0 10 10"/>')).toThrow('SVG биш')
    expect(() => prepareSvgLogo(svg(''))).toThrow('viewBox эсвэл width/height')
    expect(() => prepareSvgLogo(svg('viewBox="0 0 0 10"'))).toThrow('viewBox эсвэл width/height')
  })

  it('rejects linked images and references to other files, but keeps embedded images for a decode check', () => {
    const xlink = 'xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 10 10"'
    expect(() => prepareSvgLogo(svg(xlink, '<image xlink:href="C:\\Users\\a\\logo.png" width="5" height="5"/>'))).toThrow('Embed')
    expect(() => prepareSvgLogo(svg(xlink, '<image href="https://example.com/a.png" width="5" height="5"/>'))).toThrow('Embed')
    expect(() => prepareSvgLogo(svg(xlink, '<use href="icons.svg#mark"/>'))).toThrow('нэг файлд')
    const ok = prepareSvgLogo(svg(xlink, `<defs><rect id="r" width="1" height="1"/></defs><use xlink:href="#r"/><image xlink:href="${PIXEL}" width="5" height="5"/>`))
    expect(ok.images).toEqual([PIXEL])
  })

  it('checks SVG images embedded in the SVG too, and ignores images without any href (they draw nothing)', () => {
    const inner = svg('viewBox="0 0 5 5"', '<image href="https://example.com/a.png" width="5" height="5"/>')
    const nested = `data:image/svg+xml;base64,${btoa(inner)}`
    expect(() => prepareSvgLogo(svg('viewBox="0 0 10 10"', `<image href="${nested}" width="5" height="5"/>`))).toThrow('Embed')
    const clean = `data:image/svg+xml,${encodeURIComponent(svg('viewBox="0 0 5 5"'))}`
    expect(prepareSvgLogo(svg('viewBox="0 0 10 10"', `<image href="${clean}" width="5" height="5"/>`)).images).toEqual([clean])
    expect(prepareSvgLogo(svg('viewBox="0 0 10 10"', '<image width="5" height="5"/><use/>')).images).toEqual([])
    // Браузер "100%" мэт ганц "%"-тэй URL-кодлоогүй SVG-г зурдаг — эвдэрсэн гэж үзэхгүй.
    const raw = `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 5 5"><rect width="100%" height="100%"/></svg>`
    expect(prepareSvgLogo(svg('viewBox="0 0 10 10"', `<image href='${raw.replace(/</g, '&lt;')}' width="5" height="5"/>`)).images).toEqual([raw])
  })

  it('fits the long side and recognises SVG files by type or extension', () => {
    expect(fitSide(4, 2000)).toEqual({ w: 2000, h: 500 })
    expect(fitSide(0.5, 2000)).toEqual({ w: 1000, h: 2000 })
    expect(fitSide(5000, 2000)).toEqual({ w: 2000, h: 1 })
    expect(isSvgFile(new File([''], 'logo.SVG'))).toBe(true)
    expect(isSvgFile(new File([''], 'logo', { type: 'image/svg+xml' }))).toBe(true)
    expect(isSvgFile(new File([''], 'logo.png', { type: 'image/png' }))).toBe(false)
  })
})

describe('rasterizeSvgLogo', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  type Box = { x: number; y: number; w: number; h: number }

  /**
   * jsdom-д зураг/canvas зурагддаггүй — ачаалагдсан мэт Image, зурсан хэмжээг тэмдэглэдэг
   * canvas, `opaque` хэсэгтээ alpha > 0 буцаадаг getImageData, урьдчилан өгсөн хэмжээтэй PNG.
   */
  const stubBrowser = ({
    pngSizes = [50_000],
    opaque = 'all' as 'all' | 'none' | ((w: number, h: number, call: number) => Box | 'all'),
    taint = false,
  } = {}) => {
    let reads = 0
    const drawn: Array<{ w: number; h: number; url: string }> = []
    const blobs = new Map<string, Blob>()
    class FakeImage {
      onload: (() => void) | null = null
      onerror: (() => void) | null = null
      private url = ''
      get src() {
        return this.url
      }
      set src(url: string) {
        this.url = url
        queueMicrotask(() => (url.includes('broken') ? this.onerror?.() : this.onload?.()))
      }
    }
    vi.stubGlobal('Image', FakeImage)
    const created = vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
      const url = `blob:test/${blobs.size}`
      blobs.set(url, blob as Blob)
      return url
    })
    const revoked = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (this: HTMLCanvasElement) {
      const canvas = this
      return {
        drawImage: (image: FakeImage) => drawn.push({ w: canvas.width, h: canvas.height, url: image.src }),
        getImageData: (_x: number, _y: number, w: number, h: number) => {
          if (taint) throw new DOMException('The canvas has been tainted by cross-origin data.', 'SecurityError')
          const data = new Uint8ClampedArray(w * h * 4)
          const region = typeof opaque === 'function' ? opaque(w, h, reads++) : opaque
          if (region === 'all') for (let i = 3; i < data.length; i += 4) data[i] = 255
          else if (region !== 'none') {
            const b = region
            for (let y = b.y; y < b.y + b.h; y++) for (let x = b.x; x < b.x + b.w; x++) data[(y * w + x) * 4 + 3] = 255
          }
          return { data }
        },
      } as unknown as CanvasRenderingContext2D
    } as never)
    let call = 0
    const toBlob = vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback) => {
      const size = pngSizes[Math.min(call++, pngSizes.length - 1)]!
      callback(new Blob([new Uint8Array(size)], { type: 'image/png' }))
    })
    const svgOf = (i: number) => blobs.get(drawn[i]!.url)!.text()
    return { drawn, created, revoked, toBlob, svgOf }
  }

  const file = (text: string, name = 'teso.svg') => new File([text], name, { type: 'image/svg+xml' })

  it('renders the SVG at 2000px on the long side once and returns a PNG file, revoking every object URL', async () => {
    const browser = stubBrowser()
    const png = await rasterizeSvgLogo(file(svg('viewBox="0 0 400 100"')))
    expect(png).toMatchObject({ name: 'teso.png', type: 'image/png', size: 50_000 })
    expect(browser.drawn.map(({ w, h }) => [w, h])).toEqual([[2000, 500]])
    expect(await browser.svgOf(0)).toContain('width="2000"')
    expect(browser.revoked).toHaveBeenCalledTimes(browser.created.mock.calls.length)
  })

  it('steps the resolution down (2000 → 1400 → 1000) until the PNG fits in 2MB, then gives up with a message', async () => {
    const browser = stubBrowser({ pngSizes: [3_000_000, 2_500_000, 1_000_000] })
    const png = await rasterizeSvgLogo(file(svg('viewBox="0 0 100 100"')))
    expect(png.size).toBe(1_000_000)
    expect(browser.drawn.map(({ w, h }) => Math.max(w, h))).toEqual([2000, 1400, 1000])

    vi.restoreAllMocks()
    stubBrowser({ pngSizes: [3_000_000] })
    await expect(rasterizeSvgLogo(file(svg('viewBox="0 0 100 100"')))).rejects.toThrow('2MB-аас бага PNG')
  })

  it('trims transparent page margins and redraws only the artwork at full resolution', async () => {
    // A4 хуудсан дээрх жижиг лого: 1414×2000 зургийн 300×100 px хэсэг.
    // Тайрсан зургийг дахин хэмжихэд дүүрэн — нарийвчлах шаардлагагүй, тэр зургийг шууд ашиглана.
    const browser = stubBrowser({ opaque: (_w, _h, call) => (call === 0 ? { x: 200, y: 300, w: 300, h: 100 } : 'all') })
    const png = await rasterizeSvgLogo(file(svg('width="210mm" height="297mm" viewBox="0 0 210 297"')))
    expect(png.type).toBe('image/png')
    expect(browser.drawn).toHaveLength(2)
    expect(browser.drawn[0]).toMatchObject({ w: 1414, h: 2000 })
    // 1px нэмэлттэй хүрээ (199,299 302×102) → урт тал 2000px.
    expect(browser.drawn[1]).toMatchObject({ w: 2000, h: Math.round(2000 / (302 / 102)) })
    const cropped = rootOf(await browser.svgOf(1))
    expect(cropped.getAttribute('viewBox')).toBe('199 299 302 102')
    const inner = cropped.getElementsByTagNameNS('http://www.w3.org/2000/svg', 'svg')[0]!
    expect(inner.getAttribute('width')).toBe('1414')
    expect(inner.getAttribute('viewBox')).toBe('0 0 210 297')
  })

  it('refines the crop when the first bounds were measured too coarsely (small artwork on a large page)', async () => {
    // 2-р хэмжилтэд дүрс тайрсан зургийн 1000..1900 × 100..500 хэсэгт л байна.
    const browser = stubBrowser({
      opaque: (_w, _h, call) => (call === 0 ? { x: 200, y: 300, w: 300, h: 100 } : { x: 1000, y: 100, w: 900, h: 400 }),
    })
    await rasterizeSvgLogo(file(svg('width="210mm" height="297mm" viewBox="0 0 210 297"')))
    expect(browser.drawn).toHaveLength(3)
    const probe = browser.drawn[1]!
    const final = rootOf(await browser.svgOf(2)).getAttribute('viewBox')!.split(' ').map(Number)
    // 1px нэмэлттэй дотоод хүрээ (999,99 902×402) нь эхний хүрээний (199,299 302×102) координатад буулгагдана.
    const kx = 302 / probe.w
    const ky = 102 / probe.h
    expect(final[0]).toBeCloseTo(199 + 999 * kx, 3)
    expect(final[1]).toBeCloseTo(299 + 99 * ky, 3)
    expect(final[2]).toBeCloseTo(902 * kx, 3)
    expect(final[3]).toBeCloseTo(402 * ky, 3)
    expect(browser.drawn[2]!.w / browser.drawn[2]!.h).toBeCloseTo(final[2]! / final[3]!, 1)
  })

  it('reports an empty drawing, a tainted canvas and a broken embedded image', async () => {
    stubBrowser({ opaque: 'none' })
    await expect(rasterizeSvgLogo(file(svg('viewBox="0 0 10 10"')))).rejects.toThrow('хоосон')

    vi.restoreAllMocks()
    stubBrowser({ taint: true })
    await expect(rasterizeSvgLogo(file(svg('viewBox="0 0 10 10"')))).rejects.toThrow('PNG болгож оруулна уу')

    vi.restoreAllMocks()
    const browser = stubBrowser()
    const broken = svg('viewBox="0 0 10 10"', '<image href="data:image/png;base64,broken" width="5" height="5"/>')
    await expect(rasterizeSvgLogo(file(broken))).rejects.toThrow('эвдэрсэн')
    expect(browser.drawn).toHaveLength(0)
  })

  it('refuses files over 2MB before reading them', async () => {
    const big = new File([new Uint8Array(2 * 1024 * 1024 + 1)], 'big.svg', { type: 'image/svg+xml' })
    await expect(rasterizeSvgLogo(big)).rejects.toThrow('2MB-аас ихгүй')
  })
})
