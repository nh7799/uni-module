import { PARENT_TYPES, UploadError, type AttachmentRow, type Blobish, type DbPort, type ImageProcessor, type Parent, type Stage, type StoragePort } from './types'
import type { AttachmentConfig } from './config'
import { extFor, sha256Hex, validateUpload } from './sniff'
export interface UploadInput { name: string; size: number; type: string; bytes: () => Promise<Uint8Array> }
export interface Deps { db: DbPort; storage: StoragePort; processor: ImageProcessor; cfg: AttachmentConfig; userId: string
  sleep?: (ms: number) => Promise<void>; newId?: () => string }
export interface UploadResult { row: AttachmentRow; duplicate: boolean; notes: string[] }
const msg = (e: unknown) => e instanceof Error ? e.message : String(e)
const defaultName = (n: string) => n.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim() || 'Untitled attachment'

/** Retry an idempotent storage call for transient failures (uploads use upsert, so repeats never create duplicates). */
export async function retry<T extends { error?: unknown }>(fn: () => Promise<T>, sleep: (ms: number) => Promise<void>, attempts = 3): Promise<T> {
  let last: T | undefined
  for (let i = 0; i < attempts; i++) {
    try { last = await fn(); if (!last.error) return last } catch (e) { last = { error: { message: msg(e) } } as T }
    if (i < attempts - 1) await sleep(400 * 2 ** i)
  }
  return last!
}
const withTimeout = async <T,>(ms: number, run: (s: AbortSignal) => Promise<T>): Promise<T> => {
  const ac = new AbortController(); let t: ReturnType<typeof setTimeout> | undefined
  try { return await Promise.race([run(ac.signal), new Promise<never>((_, rej) => { t = setTimeout(() => { ac.abort(); rej(new Error(`Processing took longer than ${Math.round(ms / 1000)}s and was stopped.`)) }, ms) })]) }
  finally { clearTimeout(t) }
}
export function createAttachmentService(d: Deps) {
  const sleep = d.sleep ?? (ms => new Promise(r => setTimeout(r, ms)))
  const newId = d.newId ?? (() => crypto.randomUUID())
  const dir = (id: string) => `${d.userId}/${id}`
  const paths = (id: string, mime: string, displayMime?: string) => ({ original: `${dir(id)}/original.${extFor(mime)}`, display: `${dir(id)}/display.${extFor(displayMime ?? mime)}`, thumb: `${dir(id)}/thumb.webp` })

  async function putVerified(path: string, f: Blobish): Promise<string | null> {
    const up = await retry(() => d.storage.upload(path, f), sleep)
    if (up.error) return `Upload of ${path.split('/').pop()} failed: ${up.error.message}`
    if (!(await d.storage.exists(path, f.bytes.length))) return `${path.split('/').pop()} was uploaded but could not be found afterwards.`
    return null
  }
  /** Compensation: remove any objects we wrote and mark the row failed (best effort, never throws). */
  async function fail(id: string, written: string[], message: string): Promise<never> {
    if (written.length) await d.storage.remove(written).catch(() => undefined)
    await d.db.update(id, { status: 'failed', error: message, display_path: null, thumb_path: null, original_path: null, original_retained: false }).catch(() => undefined)
    throw new UploadError('failed', message)
  }

  /** Full pipeline. Success is reported only after: validated → row saved → processed → stored+verified → retrievable. */
  async function upload(parent: Parent, file: UploadInput, opts: { caption?: string; alt?: string; filename?: string; onStage?: (s: Stage) => void; forceOriginal?: boolean } = {}): Promise<UploadResult> {
    const stage = opts.onStage ?? (() => undefined); const notes: string[] = []
    if (!PARENT_TYPES.includes(parent.type)) throw new UploadError('bad_parent', 'Unknown parent type.')
    stage('validating')
    const bytes = await file.bytes()
    if (bytes.length !== file.size) throw new UploadError('read_failed', 'The file could not be read completely. Please try again.')
    const v = validateUpload({ size: bytes.length, type: file.type }, bytes.subarray(0, 2 * 1024 * 1024), d.cfg)
    if (!v.ok) throw new UploadError(v.code, v.message)
    if (v.declaredMismatch) notes.push(`The browser reported "${file.type}" but the content is ${v.mime}; the content was used.`)
    const checksum = await sha256Hex(bytes)

    stage('saving record')
    let row = await d.db.findByChecksum(parent, checksum)
    if (row?.status === 'available') return { row, duplicate: true, notes: ['This exact file is already attached to this record.'] }
    if (row) notes.push('Resuming an earlier unfinished upload of this file.')
    else {
      const isImage = v.mime !== 'application/pdf'
      const ins = await d.db.insert({ id: newId(), parent_type: parent.type, parent_id: parent.id, kind: isImage ? 'image' : 'document', status: 'uploading', filename: (opts.filename || defaultName(file.name)).slice(0, 200), original_name: file.name.slice(0, 255),
        mime: v.mime, byte_size: bytes.length, checksum, position: Math.max(-1, ...(await d.db.list(parent)).map(a => a.position)) + 1, caption: opts.caption ?? '', alt_text: opts.alt ?? '', width: v.width, height: v.height })
      if (ins.error?.code === '23505') { row = await d.db.findByChecksum(parent, checksum); if (!row) throw new UploadError('db', ins.error.message) }
      else if (ins.error || !ins.row) throw new UploadError('db', `Could not save the attachment record: ${ins.error?.message ?? 'unknown error'}`)
      else row = ins.row
    }
    const id = row.id, written: string[] = []
    const isImage = v.mime !== 'application/pdf'
    const keepOriginal = d.cfg.retainOriginals || opts.forceOriginal || !isImage

    let processed: Awaited<ReturnType<ImageProcessor['process']>> | null = null, procError: string | null = null
    if (isImage) {
      stage('processing'); await d.db.update(id, { status: 'processing', error: null })
      try { processed = await withTimeout(d.cfg.processingTimeoutMs, s => d.processor.process(bytes, { mime: v.mime, width: v.width!, height: v.height! }, s)) }
      catch (e) { procError = msg(e) }
    }
    stage('uploading')
    const p = paths(id, v.mime, processed?.display?.mime)
    const orig: Blobish = { bytes, mime: v.mime }
    const todo: [string, Blobish][] = []
    if (processed?.display) todo.push([p.display, processed.display])
    if (processed?.thumb) todo.push([p.thumb, processed.thumb])
    // when processing failed, the original is the safe recovery copy regardless of the retain setting
    const storeOriginal = keepOriginal || !!procError
    if (storeOriginal) todo.push([p.original, orig])
    for (const [path, f] of todo) { const err = await putVerified(path, f); written.push(path); if (err) return fail(id, written, err) }

    stage('verifying')
    const hasOrig = storeOriginal
    const patch: Partial<AttachmentRow> = {
      status: procError ? 'failed' : 'stored', error: procError ? `Image processing failed: ${procError}. The original was kept; use "Retry processing".` : null,
      width: processed?.width ?? v.width, height: processed?.height ?? v.height,
      original_path: hasOrig ? p.original : null, original_bytes: hasOrig ? bytes.length : null, original_retained: hasOrig,
      display_path: processed?.display ? p.display : (hasOrig ? p.original : null), display_mime: processed?.display ? processed.display.mime : v.mime, display_bytes: processed?.display ? processed.display.bytes.length : bytes.length,
      thumb_path: processed?.thumb ? p.thumb : null, thumb_bytes: processed?.thumb ? processed.thumb.bytes.length : null, optimized: !!processed?.optimized }
    if (procError) { patch.display_path = null; patch.display_mime = null; patch.display_bytes = null }
    const up = await d.db.update(id, patch)
    if (up.error) return fail(id, written, `Files were stored but the metadata could not be saved: ${up.error.message}`)
    if (procError) { const r = await d.db.get(id); throw Object.assign(new UploadError('processing_failed', patch.error!), { row: r }) }
    const probe = patch.thumb_path ?? patch.display_path!
    if (!(await d.storage.signedUrl(probe, 60))) return fail(id, written, 'The stored file could not be retrieved after upload.')
    const fin = await d.db.update(id, { status: 'available' })
    if (fin.error) return fail(id, written, `Could not mark the attachment available: ${fin.error.message}`)
    stage('done')
    return { row: { ...(await d.db.get(id))! }, duplicate: false, notes }
  }

  /** Re-run processing for a failed attachment using the retained original. */
  async function retryProcessing(id: string) {
    const row = await d.db.get(id)
    if (!row || !row.original_path) throw new UploadError('no_original', 'No stored original is available. Re-attach the file instead (the same file resumes this record without creating a duplicate).')
    const bytes = await d.storage.download(row.original_path)
    if (!bytes) throw new UploadError('missing_original', 'The stored original could not be downloaded.')
    await d.db.update(id, { status: 'processing', error: null })
    let pr
    try { pr = await withTimeout(d.cfg.processingTimeoutMs, s => d.processor.process(bytes, { mime: row.mime, width: row.width ?? 1, height: row.height ?? 1 }, s)) }
    catch (e) { await d.db.update(id, { status: 'failed', error: `Image processing failed: ${msg(e)}` }); throw new UploadError('processing_failed', msg(e)) }
    const p = paths(id, row.mime, pr.display?.mime), written: string[] = []
    for (const [path, f] of [[p.display, pr.display], [p.thumb, pr.thumb]] as [string, Blobish | null][]) if (f) { const err = await putVerified(path, f); written.push(path); if (err) { await d.storage.remove(written).catch(() => undefined); await d.db.update(id, { status: 'failed', error: err }); throw new UploadError('upload', err) } }
    const r = await d.db.update(id, { status: 'available', error: null, display_path: pr.display ? p.display : row.original_path, display_mime: pr.display?.mime ?? row.mime, display_bytes: pr.display?.bytes.length ?? bytes.length, thumb_path: pr.thumb ? p.thumb : null, thumb_bytes: pr.thumb?.bytes.length ?? null, optimized: !!pr.display, width: pr.width, height: pr.height })
    if (r.error) { await d.storage.remove(written).catch(() => undefined); throw new UploadError('db', r.error.message) }
    return d.db.get(id)
  }

  /** Delete = flag first (reversible), then remove files, then remove the row. Failure leaves a pending_deletion row for purge() to retry. */
  async function purgeOne(row: AttachmentRow): Promise<boolean> {
    const files = [row.original_path, row.display_path, row.thumb_path].filter((x): x is string => !!x)
    const uniq = [...new Set(files)]
    if (uniq.length) { const r = await d.storage.remove(uniq); if (r.error) return false }
    return !(await d.db.delete(row.id)).error
  }
  async function remove(id: string): Promise<{ purged: boolean; error?: string }> {
    const row = await d.db.get(id); if (!row) return { purged: true }
    const f = await d.db.update(id, { status: 'pending_deletion' })
    if (f.error) return { purged: false, error: f.error.message }
    return (await purgeOne({ ...row, status: 'pending_deletion' })) ? { purged: true } : { purged: false, error: 'Files could not be removed yet; the item is pending deletion and will be retried from the Health page.' }
  }
  /** Replace: the new file is fully stored and linked BEFORE the old one is touched. */
  async function replace(oldId: string, file: UploadInput, onStage?: (s: Stage) => void): Promise<UploadResult> {
    const old = await d.db.get(oldId); if (!old) throw new UploadError('missing', 'The attachment to replace no longer exists.')
    const res = await upload({ type: old.parent_type, id: old.parent_id }, file, { onStage, filename: old.filename, caption: old.caption, alt: old.alt_text })
    if (res.duplicate && res.row.id === old.id) throw new UploadError('same_file', 'That is the same file that is already attached.')
    await d.db.update(res.row.id, { description: old.description, extracted_text: old.extracted_text, extracted_source: old.extracted_source, extracted_edited: old.extracted_edited, position: old.position })
    await remove(old.id)  // only now is the old one flagged and purged
    return { ...res, row: (await d.db.get(res.row.id)) ?? res.row }
  }
  async function reorder(ids: string[]) { for (let i = 0; i < ids.length; i++) { const r = await d.db.update(ids[i], { position: i }); if (r.error) throw new UploadError('db', r.error.message) } }
  async function purgePending(parent?: Parent) {
    const all = parent ? await d.db.list(parent, true) : []
    let purged = 0, failed = 0
    for (const r of all.filter(r => r.status === 'pending_deletion')) (await purgeOne(r)) ? purged++ : failed++
    return { purged, failed }
  }
  return { upload, retryProcessing, remove, replace, reorder, purgeOne, purgePending }
}
export type AttachmentService = ReturnType<typeof createAttachmentService>
