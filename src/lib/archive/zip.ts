/** Minimal standards-compliant ZIP (no ZIP64) using the platform's DEFLATE (CompressionStream). No dependencies. */
export interface ZipEntry { path: string; data: Uint8Array; compress?: boolean }
const te = new TextEncoder(), td = new TextDecoder('utf-8', { fatal: true })
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0 } return t })()
export function crc32(b: Uint8Array) { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0 }
async function pipe(data: Uint8Array, s: CompressionStream | DecompressionStream, limit = Infinity): Promise<Uint8Array> {
  const reader = new Blob([data as BlobPart]).stream().pipeThrough(s as unknown as ReadableWritablePair<Uint8Array, Uint8Array>).getReader()
  const chunks: Uint8Array[] = []; let n = 0
  for (;;) { const { done, value } = await reader.read(); if (done) break; n += value.length; if (n > limit) { await reader.cancel(); throw new Error('Archive entry is larger than the allowed size (possible zip bomb).') } chunks.push(value) }
  const out = new Uint8Array(n); let o = 0; for (const c of chunks) { out.set(c, o); o += c.length } return out
}
export const deflateRaw = (d: Uint8Array) => pipe(d, new CompressionStream('deflate-raw'))
export const inflateRaw = (d: Uint8Array, limit?: number) => pipe(d, new DecompressionStream('deflate-raw'), limit)
const MAX_ENTRIES = 65000, MAX_SIZE = 0xfffffffe
export interface ZipStat { path: string; raw: number; stored: number }
export async function writeZip(entries: ZipEntry[], when = new Date(), stats?: ZipStat[]): Promise<Uint8Array> {
  if (entries.length > MAX_ENTRIES) throw new Error('Too many files for a ZIP archive (limit 65,000). Export a smaller selection.')
  const dosTime = (when.getHours() << 11) | (when.getMinutes() << 5) | (when.getSeconds() >> 1), dosDate = ((Math.max(1980, when.getFullYear()) - 1980) << 9) | ((when.getMonth() + 1) << 5) | when.getDate()
  const parts: Uint8Array[] = [], central: Uint8Array[] = []; let offset = 0
  for (const e of entries) {
    const name = te.encode(e.path); const crc = crc32(e.data)
    let body = e.data, method = 0
    if (e.compress !== false && e.data.length > 64) { const z = await deflateRaw(e.data); if (z.length < e.data.length) { body = z; method = 8 } }
    if (body.length > MAX_SIZE || e.data.length > MAX_SIZE || offset > MAX_SIZE) throw new Error('Archive would exceed the 4 GB ZIP limit. Export a smaller selection or fewer originals.')
    const h = new DataView(new ArrayBuffer(30)); h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, method, true); h.setUint16(10, dosTime, true); h.setUint16(12, dosDate, true)
    h.setUint32(14, crc, true); h.setUint32(18, body.length, true); h.setUint32(22, e.data.length, true); h.setUint16(26, name.length, true); h.setUint16(28, 0, true)
    const c = new DataView(new ArrayBuffer(46)); c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(10, method, true); c.setUint16(12, dosTime, true); c.setUint16(14, dosDate, true)
    c.setUint32(16, crc, true); c.setUint32(20, body.length, true); c.setUint32(24, e.data.length, true); c.setUint16(28, name.length, true); c.setUint32(42, offset, true)
    stats?.push({ path: e.path, raw: e.data.length, stored: body.length })
    parts.push(new Uint8Array(h.buffer), name, body); central.push(new Uint8Array(c.buffer), name); offset += 30 + name.length + body.length
  }
  const cdSize = central.reduce((s, x) => s + x.length, 0)
  const end = new DataView(new ArrayBuffer(22)); end.setUint32(0, 0x06054b50, true); end.setUint16(8, entries.length, true); end.setUint16(10, entries.length, true); end.setUint32(12, cdSize, true); end.setUint32(16, offset, true)
  const all = [...parts, ...central, new Uint8Array(end.buffer)]; const out = new Uint8Array(all.reduce((s, x) => s + x.length, 0)); let o = 0; for (const x of all) { out.set(x, o); o += x.length } return out
}
export interface ReadLimits { maxEntryBytes: number; maxTotalBytes: number }
export const DEFAULT_LIMITS: ReadLimits = { maxEntryBytes: 200 * 1024 * 1024, maxTotalBytes: 2 * 1024 * 1024 * 1024 }
export async function readZip(z: Uint8Array, limits = DEFAULT_LIMITS): Promise<Map<string, Uint8Array>> {
  const v = new DataView(z.buffer, z.byteOffset, z.byteLength); let e = z.length - 22
  while (e >= 0 && v.getUint32(e, true) !== 0x06054b50) e--
  if (e < 0) throw new Error('Not a ZIP archive (end-of-central-directory record not found).')
  const n = v.getUint16(e + 10, true), cdOff = v.getUint32(e + 16, true); let p = cdOff, total = 0
  const out = new Map<string, Uint8Array>()
  for (let i = 0; i < n; i++) {
    if (v.getUint32(p, true) !== 0x02014b50) throw new Error('Corrupt ZIP central directory.')
    const method = v.getUint16(p + 10, true), crc = v.getUint32(p + 16, true), csize = v.getUint32(p + 20, true), usize = v.getUint32(p + 24, true), nl = v.getUint16(p + 28, true), xl = v.getUint16(p + 30, true), cl = v.getUint16(p + 32, true), lho = v.getUint32(p + 42, true)
    const name = td.decode(z.subarray(p + 46, p + 46 + nl)); p += 46 + nl + xl + cl
    if (usize > limits.maxEntryBytes || (total += usize) > limits.maxTotalBytes) throw new Error(`Archive is larger than the allowed size (entry "${name}").`)
    if (v.getUint32(lho, true) !== 0x04034b50) throw new Error(`Corrupt ZIP entry header for "${name}".`)
    const start = lho + 30 + v.getUint16(lho + 26, true) + v.getUint16(lho + 28, true); const raw = z.subarray(start, start + csize)
    if (name.endsWith('/')) continue
    const data = method === 0 ? raw.slice() : method === 8 ? await inflateRaw(raw, usize + 1) : (() => { throw new Error(`Unsupported ZIP compression method ${method} for "${name}".`) })()
    if (data.length !== usize || crc32(data) !== crc) throw new Error(`Checksum mismatch in "${name}": the archive is damaged.`)
    if (out.has(name)) throw new Error(`Duplicate entry "${name}" in archive.`)
    out.set(name, data)
  }
  return out
}
