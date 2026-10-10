import test from 'node:test'; import assert from 'node:assert/strict'
import { DEFAULT_CONFIG, sanitizeConfig } from '../lib/attachments/config'
import { readDimensions, sniffMime, validateUpload } from '../lib/attachments/sniff'
import { chooseDisplay, planProcessing } from '../lib/attachments/process'
import { jpeg, png, webp } from './fakes'
const cfg = DEFAULT_CONFIG
test('sniffing uses content, not the declared type', () => {
  assert.equal(sniffMime(png(10, 10)), 'image/png'); assert.equal(sniffMime(jpeg(10, 10)), 'image/jpeg'); assert.equal(sniffMime(webp(10, 10)), 'image/webp')
  assert.equal(sniffMime(new TextEncoder().encode('<script>alert(1)</script>')), null)
  const r = validateUpload({ size: 200, type: 'image/jpeg' }, png(10, 10, 200), cfg); assert.ok(r.ok && r.mime === 'image/png' && r.declaredMismatch)
})
test('header dimensions', () => { assert.deepEqual(readDimensions(png(640, 480), 'image/png'), { width: 640, height: 480 }); assert.deepEqual(readDimensions(jpeg(1024, 768), 'image/jpeg'), { width: 1024, height: 768 }); assert.deepEqual(readDimensions(webp(300, 200), 'image/webp'), { width: 300, height: 200 }) })
test('rejects bad uploads before any decoding', () => {
  const code = (r: ReturnType<typeof validateUpload>) => r.ok ? 'ok' : r.code
  assert.equal(code(validateUpload({ size: 0, type: '' }, new Uint8Array(0), cfg)), 'empty')
  assert.equal(code(validateUpload({ size: cfg.maxUploadBytes + 1, type: 'image/png' }, png(5, 5), cfg)), 'too_large')
  assert.equal(code(validateUpload({ size: 100, type: 'image/png' }, new TextEncoder().encode('<html>not an image at all</html>'), cfg)), 'unsupported')
  assert.equal(code(validateUpload({ size: 100, type: 'image/png' }, png(30000, 30000), cfg)), 'too_many_pixels')   // decompression bomb
  assert.equal(code(validateUpload({ size: 100, type: 'image/png' }, png(0, 0), cfg)), 'bad_dimensions')
  assert.equal(code(validateUpload({ size: 100, type: 'image/png' }, png(5, 5), { ...cfg, allowedMimes: ['image/jpeg'] })), 'not_allowed')
  assert.equal(code(validateUpload({ size: 100, type: 'application/pdf' }, Uint8Array.from([...'%PDF-1.7 .......'].map(c => c.charCodeAt(0))), cfg)), 'ok')
})
test('processing plan avoids needless recompression and keeps transparency', () => {
  const big = { mime: 'image/jpeg' as const, width: 4000, height: 3000, byteSize: 3e6 }
  assert.equal(planProcessing(big, cfg).keepOriginalAsDisplay, false); assert.equal(planProcessing(big, cfg).width, 2400); assert.equal(planProcessing(big, cfg).format, 'webp')
  assert.equal(planProcessing({ ...big, width: 800, height: 600, byteSize: 100_000 }, cfg).keepOriginalAsDisplay, true)       // already small
  assert.equal(planProcessing({ mime: 'image/webp', width: 1000, height: 1000, byteSize: 9e6 }, cfg).keepOriginalAsDisplay, true) // already optimized
  assert.equal(planProcessing({ mime: 'image/gif', width: 4000, height: 4000, byteSize: 9e6 }, cfg).keepOriginalAsDisplay, true)  // animation preserved
  assert.equal(planProcessing({ mime: 'image/png', width: 3000, height: 3000, byteSize: 9e6, hasAlpha: true }, cfg).format, 'png')
  assert.equal(planProcessing({ mime: 'image/png', width: 3000, height: 3000, byteSize: 9e6, hasAlpha: false }, cfg).format, 'webp')
  assert.equal(chooseDisplay(1000, 1000, false), false); assert.equal(chooseDisplay(500, 1000, false), true); assert.equal(chooseDisplay(2000, 1000, true), true)
})
test('config is clamped to safe bounds', () => { const c = sanitizeConfig({ maxUploadBytes: 1e12, quality: 5, maxPixels: -1, thumbDim: 1e9 }); assert.equal(c.maxUploadBytes, DEFAULT_CONFIG.maxUploadBytes); assert.equal(c.quality, 1); assert.ok(c.maxPixels >= 1e4); assert.equal(c.thumbDim, 1024) })
