import type { Mime } from './types'
export interface AttachmentConfig {
  maxUploadBytes: number; maxPixels: number; maxDisplayDim: number; thumbDim: number
  quality: number; thumbQuality: number; retainOriginals: boolean
  skipRecompressBelowBytes: number; processingTimeoutMs: number; allowedMimes: Mime[]
}
export const DEFAULT_CONFIG: AttachmentConfig = {
  maxUploadBytes: 25 * 1024 * 1024,      // must not exceed the bucket limit set in migration 0003 (25 MiB)
  maxPixels: 60_000_000,                 // decompression-bomb guard, checked from the header BEFORE decoding
  maxDisplayDim: 2400, thumbDim: 320, quality: 0.82, thumbQuality: 0.7,
  retainOriginals: true, skipRecompressBelowBytes: 400 * 1024, processingTimeoutMs: 30_000,
  allowedMimes: ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif', 'application/pdf'] }
const clamp = (n: unknown, lo: number, hi: number, d: number) => typeof n === 'number' && Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d
export function sanitizeConfig(raw: Partial<AttachmentConfig> | null | undefined): AttachmentConfig {
  const r = raw ?? {}; const d = DEFAULT_CONFIG
  return { maxUploadBytes: clamp(r.maxUploadBytes, 1024, d.maxUploadBytes, d.maxUploadBytes), maxPixels: clamp(r.maxPixels, 1e4, 2e8, d.maxPixels),
    maxDisplayDim: clamp(r.maxDisplayDim, 320, 8000, d.maxDisplayDim), thumbDim: clamp(r.thumbDim, 64, 1024, d.thumbDim),
    quality: clamp(r.quality, 0.4, 1, d.quality), thumbQuality: clamp(r.thumbQuality, 0.3, 1, d.thumbQuality),
    retainOriginals: typeof r.retainOriginals === 'boolean' ? r.retainOriginals : d.retainOriginals,
    skipRecompressBelowBytes: clamp(r.skipRecompressBelowBytes, 0, d.maxUploadBytes, d.skipRecompressBelowBytes),
    processingTimeoutMs: clamp(r.processingTimeoutMs, 1000, 300_000, d.processingTimeoutMs),
    allowedMimes: Array.isArray(r.allowedMimes) ? d.allowedMimes.filter(m => r.allowedMimes!.includes(m)) : d.allowedMimes }
}
const KEY = 'attachment-config'
export function loadConfig(): AttachmentConfig { try { return sanitizeConfig(JSON.parse(localStorage.getItem(KEY) || 'null')) } catch { return DEFAULT_CONFIG } }
export function saveConfig(c: Partial<AttachmentConfig>) { try { localStorage.setItem(KEY, JSON.stringify(sanitizeConfig(c))) } catch { /* preference only */ } }
