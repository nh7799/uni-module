import type { AttachmentConfig } from './config'
import type { ImageProcessor, Mime, ProcessedImage } from './types'
export interface Plan { keepOriginalAsDisplay: boolean; format: 'webp' | 'png'; width: number; height: number; reason: string }
/** Decide how to build the display version. Pure, so it is unit-tested. `hasAlpha` is only needed for PNG. */
export function planProcessing(m: { mime: Mime; width: number; height: number; byteSize: number; hasAlpha?: boolean }, cfg: AttachmentConfig): Plan {
  const scale = Math.min(1, cfg.maxDisplayDim / Math.max(m.width, m.height))
  const width = Math.max(1, Math.round(m.width * scale)), height = Math.max(1, Math.round(m.height * scale))
  const small = scale === 1
  if (m.mime === 'image/gif') return { keepOriginalAsDisplay: true, format: 'webp', width: m.width, height: m.height, reason: 'GIF kept as-is to preserve animation' }
  if (m.mime === 'image/avif' && small) return { keepOriginalAsDisplay: true, format: 'webp', width: m.width, height: m.height, reason: 'already AVIF' }
  if (small && m.mime === 'image/webp') return { keepOriginalAsDisplay: true, format: 'webp', width: m.width, height: m.height, reason: 'already WebP within size limits' }
  if (small && m.byteSize <= cfg.skipRecompressBelowBytes) return { keepOriginalAsDisplay: true, format: 'webp', width: m.width, height: m.height, reason: 'already small; recompressing would only lose quality' }
  const png = m.mime === 'image/png' && m.hasAlpha !== false  // alpha unknown => be safe and keep PNG
  return { keepOriginalAsDisplay: false, format: png ? 'png' : 'webp', width, height, reason: scale < 1 ? `resized to fit ${cfg.maxDisplayDim}px` : 'recompressed' }
}
/** Decide whether to use the re-encoded display image or fall back to the original (never make files bigger). */
export const chooseDisplay = (encodedBytes: number, originalBytes: number, resized: boolean) => resized || encodedBytes < originalBytes * 0.95
type Canvas = HTMLCanvasElement | OffscreenCanvas
function makeCanvas(w: number, h: number): Canvas { if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h); const c = document.createElement('canvas'); c.width = w; c.height = h; return c }
async function toBlob(c: Canvas, type: string, q: number): Promise<Blob> {
  const b = 'convertToBlob' in c ? await c.convertToBlob({ type, quality: q }) : await new Promise<Blob | null>(r => (c as HTMLCanvasElement).toBlob(r, type, q))
  if (!b) throw new Error('The browser could not encode the image.')
  return b
}
async function encode(c: Canvas, want: 'webp' | 'png', q: number) {
  if (want === 'png') return toBlob(c, 'image/png', 1)
  const b = await toBlob(c, 'image/webp', q)
  return b.type === 'image/webp' ? b : toBlob(c, 'image/jpeg', q)   // browsers without WebP encoding fall back to JPEG
}
const bytesOf = async (b: Blob) => new Uint8Array(await b.arrayBuffer())
function draw(bmp: ImageBitmap, w: number, h: number) { const c = makeCanvas(w, h); const x = c.getContext('2d') as CanvasRenderingContext2D; x.imageSmoothingQuality = 'high'; x.drawImage(bmp, 0, 0, w, h); return { c, x } }
function hasTransparency(x: CanvasRenderingContext2D, w: number, h: number) { const d = x.getImageData(0, 0, w, h).data; for (let i = 3; i < d.length; i += 4) if (d[i] < 255) return true; return false }
/** Browser implementation: decodes with orientation correction, resizes, encodes WebP/PNG and builds a thumbnail. */
export const browserProcessor = (cfg: AttachmentConfig): ImageProcessor => ({
  async process(bytes, info, signal): Promise<ProcessedImage> {
    const bmp = await createImageBitmap(new Blob([bytes as BlobPart], { type: info.mime }), { imageOrientation: 'from-image' })
    try {
      if (signal.aborted) throw new Error('Processing timed out.')
      const w0 = bmp.width, h0 = bmp.height
      let plan = planProcessing({ mime: info.mime, width: w0, height: h0, byteSize: bytes.length, hasAlpha: undefined }, cfg)
      let display: ProcessedImage['display'] = null, optimized = false
      if (!plan.keepOriginalAsDisplay) {
        const { c, x } = draw(bmp, plan.width, plan.height)
        if (info.mime === 'image/png') plan = planProcessing({ mime: info.mime, width: w0, height: h0, byteSize: bytes.length, hasAlpha: hasTransparency(x, plan.width, plan.height) }, cfg)
        if (!plan.keepOriginalAsDisplay) {
          const blob = await encode(c, plan.format, cfg.quality)
          if (chooseDisplay(blob.size, bytes.length, plan.width !== w0 || plan.height !== h0)) { display = { bytes: await bytesOf(blob), mime: blob.type }; optimized = true }
        }
      }
      if (signal.aborted) throw new Error('Processing timed out.')
      const ts = Math.min(1, cfg.thumbDim / Math.max(w0, h0)), tw = Math.max(1, Math.round(w0 * ts)), th = Math.max(1, Math.round(h0 * ts))
      const t = draw(bmp, tw, th); const tb = await encode(t.c, 'webp', cfg.thumbQuality)
      return { display, thumb: { bytes: await bytesOf(tb), mime: tb.type }, width: w0, height: h0, optimized }
    } finally { bmp.close() }
  } })
