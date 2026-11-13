/*
 * SVG логог браузерт PNG болгоно: сервер зөвхөн PNG хадгалж PDF-д оруулдаг тул SVG-г
 * өндөр нягтралтай (урт тал 2000px — серверийн хязгаар) зургаар илгээнэ. SVG-г <img>-ээр
 * зурдаг тул доторх script ажиллахгүй, гадны файл/фонт татагдахгүй.
 */

const SVG_NS = 'http://www.w3.org/2000/svg'
const XLINK_NS = 'http://www.w3.org/1999/xlink'
export const SVG_LOGO_LIMITS = { bytes: 2 * 1024 * 1024, maxSide: 2000 } as const
/** PNG 2MB-аас хэтэрвэл (градиент ихтэй лого) нягтралыг бууруулж дахин оролдоно. */
export const RENDER_SIDES = [SVG_LOGO_LIMITS.maxSide, 1400, 1000, 700] as const
/** Ил тод хүрээ нь зургийн энэ хэсгээс их бол (Inkscape/Illustrator-ын хуудас, artboard) тайрна. */
const TRIM_THRESHOLD = 0.98

export const isSvgFile = (file: File) => file.type === 'image/svg+xml' || /\.svg$/i.test(file.name)

/** CSS-ийн үнэмлэхүй нэгжийг px болгоно; хувь, em зэрэг харьцангуй нэгжийг үл тооцно. */
const UNIT_PX: Record<string, number> = { '': 1, px: 1, pt: 4 / 3, pc: 16, mm: 96 / 25.4, cm: 96 / 2.54, in: 96 }

function lengthPx(value: string | null): number | null {
  const match = value?.trim().match(/^([+]?\d*\.?\d+(?:e[+-]?\d+)?)\s*(px|pt|pc|mm|cm|in)?$/i)
  if (!match) return null
  const px = Number(match[1]) * UNIT_PX[(match[2] ?? '').toLowerCase()]!
  return Number.isFinite(px) && px > 0 ? px : null
}

function parseViewBox(value: string | null) {
  const parts = value?.trim().split(/[\s,]+/).map(Number)
  if (!parts || parts.length !== 4 || !parts.every(Number.isFinite)) return null
  const [, , w, h] = parts as [number, number, number, number]
  return w > 0 && h > 0 ? { w, h } : null
}

const hrefOf = (element: Element) => (element.getAttribute('href') ?? element.getAttributeNS(XLINK_NS, 'href') ?? '').trim()

export class SvgLogoError extends Error {}

const LINKED_IMAGE = 'SVG доторх зураг гадны файлтай холбогдсон байна — зургийг SVG-д шингээж (Embed) хадгалаад дахин оруулна уу'
const LINKED_USE = 'SVG нь өөр файлын хэсгийг ашигласан байна — бүх дүрсийг нэг файлд хадгалаад дахин оруулна уу'
/** SVG доторх шингээсэн SVG-г (data:image/svg+xml) хэдэн түвшин хүртэл шалгах. */
const MAX_NESTING = 4

/** data: URI-ийн агуулга (base64 эсвэл URL-кодлосон); уншиж чадахгүй бол null. */
function dataUriText(uri: string): string | null {
  const comma = uri.indexOf(',')
  if (comma < 0) return null
  const meta = uri.slice(5, comma)
  const body = uri.slice(comma + 1)
  try {
    if (/;base64$/i.test(meta)) {
      const bytes = Uint8Array.from(atob(body.replace(/\s+/g, '')), (c) => c.charCodeAt(0))
      return new TextDecoder().decode(bytes)
    }
    return percentDecode(body)
  } catch {
    return null
  }
}

/** Браузер шиг уучлалтай: зөв %XX-ийг л задална, "100%" мэт ганц "%"-ийг хэвээр үлдээнэ. */
function percentDecode(body: string): string {
  const bytes: number[] = []
  const encoder = new TextEncoder()
  for (let i = 0; i < body.length; ) {
    if (body[i] === '%' && /^[0-9a-f]{2}$/i.test(body.slice(i + 1, i + 3))) {
      bytes.push(parseInt(body.slice(i + 1, i + 3), 16))
      i += 3
    } else {
      const char = String.fromCodePoint(body.codePointAt(i)!)
      bytes.push(...encoder.encode(char))
      i += char.length
    }
  }
  return new TextDecoder().decode(new Uint8Array(bytes))
}

/**
 * Гадны файлтай холбосон <image>, өөр файлын <use>-ийг хайна. <img>-ээр зурахад тэдгээр
 * ачаалагдахгүй — Chrome эвдэрсэн зургийн тэмдэг зурж логонд үлдээдэг. Хоосон href зурагдахгүй
 * тул алгасна. Шингээсэн SVG зургийн дотор ч мөн адил шалгана. Шингээсэн зургуудыг буцаана.
 */
function checkReferences(root: Element, depth: number): string[] {
  const images: string[] = []
  for (const image of Array.from(root.getElementsByTagNameNS(SVG_NS, 'image'))) {
    const href = hrefOf(image)
    if (!href) continue
    if (!/^data:image\//i.test(href)) throw new SvgLogoError(LINKED_IMAGE)
    if (/^data:image\/svg\+xml/i.test(href)) {
      const inner = dataUriText(href)
      const doc = inner === null ? null : new DOMParser().parseFromString(inner, 'image/svg+xml')
      if (!doc || doc.getElementsByTagName('parsererror').length > 0 || depth >= MAX_NESTING) {
        throw new SvgLogoError('SVG доторх зураг эвдэрсэн байна — зургийг дахин шингээж хадгална уу')
      }
      checkReferences(doc.documentElement, depth + 1)
    }
    images.push(href)
  }
  for (const use of Array.from(root.getElementsByTagNameNS(SVG_NS, 'use'))) {
    const href = hrefOf(use)
    if (href && !href.startsWith('#')) throw new SvgLogoError(LINKED_USE)
  }
  return images
}

/**
 * SVG-г шалгаж хэмжээг (харьцааг) олно, `at(w, h)` нь яг тэр хэмжээтэй зурагдах SVG текст буцаана.
 * viewBox-гүй бол width/height-ээр viewBox нэмж агуулгыг хамт томруулна. Доторх зураг нь SVG-д
 * шингээгээгүй (гадны файл, вэб хаяг) бол <img> түүнийг ачаалж чадахгүй — Chrome эвдэрсэн
 * зургийн тэмдэг зурж логонд үлдээдэг тул шууд татгалзана.
 */
export function prepareSvgLogo(source: string) {
  const doc = new DOMParser().parseFromString(source, 'image/svg+xml')
  const root = doc.documentElement
  if (doc.getElementsByTagName('parsererror').length > 0 || root.localName !== 'svg' || root.namespaceURI !== SVG_NS) {
    throw new SvgLogoError('SVG файлыг уншиж чадсангүй — файл эвдэрсэн эсвэл SVG биш байна')
  }
  const images = checkReferences(root, 0)

  const viewBox = parseViewBox(root.getAttribute('viewBox'))
  const width = lengthPx(root.getAttribute('width'))
  const height = lengthPx(root.getAttribute('height'))
  // width/height хоёулаа байвал зураг тэр харьцаагаар харагдана (viewBox нь preserveAspectRatio-аар багтана).
  const size = width && height ? { w: width, h: height } : viewBox
  if (!size) throw new SvgLogoError('SVG-д хэмжээ (viewBox эсвэл width/height) алга байна')
  if (!viewBox) root.setAttribute('viewBox', `0 0 ${size.w} ${size.h}`)
  // Гадна талын <svg>-д x/y үйлчилдэггүй ч тайрах үед дотор SVG болж байрлалыг шилжүүлнэ.
  root.removeAttribute('x')
  root.removeAttribute('y')

  return {
    aspect: size.w / size.h,
    /** SVG-д шингээсэн зургууд (data: URI) — эвдэрсэн эсэхийг зурахаас өмнө шалгана. */
    images,
    at(w: number, h: number) {
      root.setAttribute('width', String(w))
      root.setAttribute('height', String(h))
      return new XMLSerializer().serializeToString(root)
    },
  }
}

/** Харьцааг хадгалан урт талыг `side` px болгоно. */
export const fitSide = (aspect: number, side: number) =>
  aspect >= 1
    ? { w: side, h: Math.max(1, Math.round(side / aspect)) }
    : { w: Math.max(1, Math.round(side * aspect)), h: side }

type Bounds = { x: number; y: number; w: number; h: number }

/**
 * Бүтэн зургийн (`inner`, w0×h0 px) зөвхөн `b` хэсгийг w×h px-ээр зурна — гадна SVG-ийн viewBox
 * нь дотор SVG-ийн px координатаар тайрдаг тул вектор чанараараа, санах ой бага зарцуулж зурагдана.
 */
const cropSvg = (inner: string, b: Bounds, w: number, h: number) =>
  `<svg xmlns="${SVG_NS}" width="${w}" height="${h}" viewBox="${b.x} ${b.y} ${b.w} ${b.h}" preserveAspectRatio="none">${inner}</svg>`

function loadImage(src: string, error: string): Promise<HTMLImageElement> {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new SvgLogoError(error))
    image.src = src
  })
}

async function renderSvg(svg: string, w: number, h: number): Promise<HTMLCanvasElement> {
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }))
  try {
    const image = await loadImage(url, 'SVG зургийг зурж чадсангүй')
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const context = canvas.getContext('2d')
    if (!context) throw new SvgLogoError('Браузер SVG-г хөрвүүлж чадсангүй')
    context.drawImage(image, 0, 0, w, h)
    return canvas
  } finally {
    URL.revokeObjectURL(url)
  }
}

/** Харагдах (alpha > 0) пикселийн хүрээ, 1px нэмэлттэй; бүх пиксел ил тод бол null. */
function opaqueBounds(canvas: HTMLCanvasElement): Bounds | null {
  let data: Uint8ClampedArray
  try {
    data = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data
  } catch {
    // foreignObject-той SVG canvas-ыг "бохирдуулж" уншихыг хориглодог.
    throw new SvgLogoError('Энэ SVG-г хөрвүүлэх боломжгүй — PNG болгож оруулна уу')
  }
  const { width, height } = canvas
  let minX = width
  let minY = height
  let maxX = -1
  let maxY = -1
  for (let y = 0; y < height; y++) {
    const row = y * width * 4
    for (let x = 0; x < width; x++) {
      if (data[row + x * 4 + 3]! > 0) {
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        maxY = y
      }
    }
  }
  if (maxX < 0) return null
  const x = Math.max(0, minX - 1)
  const y = Math.max(0, minY - 1)
  return { x, y, w: Math.min(width, maxX + 2) - x, h: Math.min(height, maxY + 2) - y }
}

function toPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise<Blob>((resolve, reject) => {
    try {
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new SvgLogoError('Браузер SVG-г хөрвүүлж чадсангүй'))), 'image/png')
    } catch {
      reject(new SvgLogoError('Энэ SVG-г хөрвүүлэх боломжгүй — PNG болгож оруулна уу'))
    }
  })
}

/**
 * SVG файлыг 2MB-аас хэтрэхгүй PNG файл болгоно. Эхлээд урт талыг 2000px-ээр зурж ил тод
 * хүрээг (хуудас, artboard-ын илүү зай) олж, хэрэв байвал зөвхөн дүрсийг бүтэн нягтралаар дахин зурна —
 * эс бөгөөс лого томруулсан ч жижигхэн гарна.
 */
export async function rasterizeSvgLogo(file: File): Promise<File> {
  if (file.size > SVG_LOGO_LIMITS.bytes) throw new SvgLogoError('Логоны файл 2MB-аас ихгүй байх ёстой')
  const prepared = prepareSvgLogo(await file.text())
  for (const href of prepared.images) {
    await loadImage(href, 'SVG доторх зураг эвдэрсэн байна — зургийг дахин шингээж хадгална уу')
  }

  const full = fitSide(prepared.aspect, SVG_LOGO_LIMITS.maxSide)
  const fullSvg = prepared.at(full.w, full.h)
  const first = await renderSvg(fullSvg, full.w, full.h)
  let bounds = opaqueBounds(first)
  if (!bounds) throw new SvgLogoError('SVG хоосон байна — харагдах дүрс алга')
  const margins = (b: Bounds, w: number, h: number) => b.w < w * TRIM_THRESHOLD || b.h < h * TRIM_THRESHOLD
  const trim = margins(bounds, full.w, full.h)
  // Том хуудсан дээрх жижиг дүрсийн хүрээг бага нягтралаар олсон тул (1px = олон px) тайрсан зургийг
  // дахин хэмжиж хүрээг нарийвчилна.
  let ready: HTMLCanvasElement | null = trim ? null : first
  if (trim) {
    const probe = fitSide(bounds.w / bounds.h, SVG_LOGO_LIMITS.maxSide)
    const canvas = await renderSvg(cropSvg(fullSvg, bounds, probe.w, probe.h), probe.w, probe.h)
    const inner = opaqueBounds(canvas)
    if (inner && margins(inner, probe.w, probe.h)) {
      const kx = bounds.w / probe.w
      const ky = bounds.h / probe.h
      bounds = { x: bounds.x + inner.x * kx, y: bounds.y + inner.y * ky, w: inner.w * kx, h: inner.h * ky }
    } else {
      ready = canvas
    }
  }
  const aspect = trim ? bounds.w / bounds.h : prepared.aspect

  const name = `${file.name.replace(/\.svg$/i, '') || 'logo'}.png`
  for (const side of RENDER_SIDES) {
    const { w, h } = fitSide(aspect, side)
    const canvas =
      ready && side === SVG_LOGO_LIMITS.maxSide
        ? ready
        : await renderSvg(trim ? cropSvg(fullSvg, bounds, w, h) : prepared.at(w, h), w, h)
    const png = await toPng(canvas)
    if (png.size <= SVG_LOGO_LIMITS.bytes) return new File([png], name, { type: 'image/png' })
  }
  throw new SvgLogoError('SVG-г 2MB-аас бага PNG болгож чадсангүй — илүү энгийн лого оруулна уу')
}
