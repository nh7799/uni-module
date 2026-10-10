import type { AttachmentConfig } from './config'
import type { Mime } from './types'
const eq = (b: Uint8Array, at: number, s: number[] | string) => { const a = typeof s === 'string' ? [...s].map(c => c.charCodeAt(0)) : s; return a.every((v, i) => b[at + i] === v) }
/** Identify a file by its content, never by filename or browser-reported type. */
export function sniffMime(b: Uint8Array): Mime | null {
  if (b.length < 12) return null
  if (eq(b, 0, [0xff, 0xd8, 0xff])) return 'image/jpeg'
  if (eq(b, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png'
  if (eq(b, 0, 'RIFF') && eq(b, 8, 'WEBP')) return 'image/webp'
  if (eq(b, 0, 'GIF87a') || eq(b, 0, 'GIF89a')) return 'image/gif'
  if (eq(b, 4, 'ftyp') && (eq(b, 8, 'avif') || eq(b, 8, 'avis'))) return 'image/avif'
  if (eq(b, 0, '%PDF-')) return 'application/pdf'
  return null
}
const u16 = (b: Uint8Array, i: number) => (b[i] << 8) | b[i + 1]
const u32 = (b: Uint8Array, i: number) => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0
/** Read pixel dimensions from the file header without decoding the image. */
export function readDimensions(b: Uint8Array, mime: Mime): { width: number; height: number } | null {
  try {
    if (mime === 'image/png') return eq(b, 12, 'IHDR') ? { width: u32(b, 16), height: u32(b, 20) } : null
    if (mime === 'image/gif') return { width: b[6] | (b[7] << 8), height: b[8] | (b[9] << 8) }
    if (mime === 'image/jpeg') {
      let i = 2
      while (i + 9 < b.length) {
        if (b[i] !== 0xff) return null
        const m = b[i + 1]
        if (m === 0xff) { i++; continue }
        if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { height: u16(b, i + 5), width: u16(b, i + 7) }
        i += 2 + u16(b, i + 2)
      }
      return null
    }
    if (mime === 'image/webp') {
      if (eq(b, 12, 'VP8X')) return { width: 1 + (b[24] | (b[25] << 8) | (b[26] << 16)), height: 1 + (b[27] | (b[28] << 8) | (b[29] << 16)) }
      if (eq(b, 12, 'VP8L')) { const v = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24); return { width: 1 + (v & 0x3fff), height: 1 + ((v >>> 14) & 0x3fff) } }
      if (eq(b, 12, 'VP8 ')) return { width: (b[26] | (b[27] << 8)) & 0x3fff, height: (b[28] | (b[29] << 8)) & 0x3fff }
      return null
    }
    if (mime === 'image/avif') {
      for (let i = 4; i + 16 < b.length; i++) if (eq(b, i, 'ispe')) return { width: u32(b, i + 8), height: u32(b, i + 12) }
      return null
    }
  } catch { /* fall through */ }
  return null
}
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', bytes as BufferSource)
  return [...new Uint8Array(d)].map(x => x.toString(16).padStart(2, '0')).join('')
}
export const extFor = (m: string) => ({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/avif': 'avif', 'application/pdf': 'pdf' } as Record<string, string>)[m] ?? 'bin'
export type Validation = { ok: true; mime: Mime; width: number | null; height: number | null; declaredMismatch: boolean } | { ok: false; code: string; message: string }
const norm = (t: string) => t === 'image/jpg' || t === 'image/pjpeg' ? 'image/jpeg' : t === 'image/x-png' ? 'image/png' : t
/** `head` must contain at least the first bytes of the file (we use up to 2 MiB). */
export function validateUpload(f: { size: number; type: string }, head: Uint8Array, cfg: AttachmentConfig): Validation {
  if (f.size <= 0) return { ok: false, code: 'empty', message: 'The file is empty.' }
  if (f.size > cfg.maxUploadBytes) return { ok: false, code: 'too_large', message: `The file is ${(f.size / 1048576).toFixed(1)} MB; the limit is ${(cfg.maxUploadBytes / 1048576).toFixed(0)} MB.` }
  const mime = sniffMime(head)
  if (!mime) return { ok: false, code: 'unsupported', message: 'The file content is not a supported image or PDF (JPEG, PNG, WebP, GIF, AVIF, PDF).' }
  if (!cfg.allowedMimes.includes(mime)) return { ok: false, code: 'not_allowed', message: `${mime} files are not allowed by the current settings.` }
  const mismatch = !!f.type && norm(f.type) !== mime
  if (mime === 'application/pdf') return { ok: true, mime, width: null, height: null, declaredMismatch: mismatch }
  const dim = readDimensions(head, mime)
  if (!dim || dim.width < 1 || dim.height < 1) return { ok: false, code: 'bad_dimensions', message: 'The image header is damaged or its size cannot be read.' }
  if (dim.width * dim.height > cfg.maxPixels) return { ok: false, code: 'too_many_pixels', message: `The image is ${dim.width}×${dim.height} (${((dim.width * dim.height) / 1e6).toFixed(0)} megapixels); the limit is ${(cfg.maxPixels / 1e6).toFixed(0)} megapixels.` }
  return { ok: true, mime, width: dim.width, height: dim.height, declaredMismatch: mismatch }
}
