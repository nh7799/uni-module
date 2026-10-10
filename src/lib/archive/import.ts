import { sha256Hex } from '../attachments/sniff'
import { ENTITY_TABLES, FORMAT_ID, SUPPORTED_MAJOR, TABLES, TABLE_ORDER, type Manifest, type Row, type TableName } from './schema'
const td = new TextDecoder('utf-8', { fatal: true })
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const SAFE = /^(?![/\\])(?!.*(^|\/)\.\.?(\/|$))[^\\:\u0000-\u001f]+$/
const FILE = /^files\/([0-9a-f-]{36})\/(original|display|thumb)\.([a-z0-9]{1,8})$/
const KINDS = ['module', 'timetable', 'lecture', 'note', 'resource', 'assessment', 'programming_note', 'fyp_research', 'fyp_milestone', 'experiment', 'meeting', 'revision_card', 'research_source', 'knowledge']
const MIMES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif', 'application/pdf']
export interface ValidationResult { ok: boolean; errors: string[]; warnings: string[]; manifest?: Manifest; tables: Partial<Record<TableName, Row[]>>; files: Map<string, Uint8Array>; summary: Record<string, number>; metadataOnly: string[] }
export async function validateArchive(entries: Map<string, Uint8Array>): Promise<ValidationResult> {
  const errors: string[] = [], warnings: string[] = []; const tables: ValidationResult['tables'] = {}; const files = new Map<string, Uint8Array>()
  const res = (manifest?: Manifest, metadataOnly: string[] = []): ValidationResult => ({ ok: errors.length === 0, errors, warnings, manifest, tables, files, summary: Object.fromEntries(Object.entries(tables).map(([k, v]) => [k, v!.length])), metadataOnly })
  for (const p of entries.keys()) if (!SAFE.test(p)) errors.push(`Unsafe file path in archive: ${JSON.stringify(p)}`)
  const mraw = entries.get('manifest.json'); if (!mraw) { errors.push('manifest.json is missing: this is not a valid archive.'); return res() }
  let m: Manifest; try { m = JSON.parse(td.decode(mraw)) } catch { errors.push('manifest.json is not valid UTF-8 JSON.'); return res() }
  if (m.format !== FORMAT_ID) { errors.push(`Unknown archive format "${m.format}".`); return res() }
  const major = Number(String(m.schema_version).split('.')[0])
  if (!Number.isInteger(major) || major > SUPPORTED_MAJOR || major < 1) { errors.push(`Unsupported schema version "${m.schema_version}" (this app reads ${SUPPORTED_MAJOR}.x).`); return res(m) }
  if (m.encoding !== 'utf-8') errors.push(`Unsupported text encoding "${m.encoding}".`)
  if (m.contents === 'readable') { errors.push('This is a readable-only archive (no data/*.jsonl). It cannot be imported; export the compact format to be able to restore.'); return res(m) }
  // ---- tables ----
  for (const t of TABLE_ORDER) {
    const info = m.tables?.[t]; if (!info) continue
    if (info.file !== `data/${t}.jsonl`) { errors.push(`${t}: unexpected file path ${JSON.stringify(info.file)}.`); continue }
    const raw = entries.get(info.file); if (!raw) { errors.push(`${t}: ${info.file} listed in manifest but missing.`); continue }
    if (await sha256Hex(raw) !== info.sha256) { errors.push(`${t}: checksum mismatch for ${info.file}; the file was modified or damaged.`); continue }
    let lines: string[]; try { lines = td.decode(raw).split('\n').filter(Boolean) } catch { errors.push(`${t}: not valid UTF-8.`); continue }
    let head: { table: string; columns: string[] }; try { head = JSON.parse(lines[0]) } catch { errors.push(`${t}: header line is not JSON.`); continue }
    const spec = TABLES[t]; const bad = (head.columns ?? []).filter(c => !spec.cols.includes(c))
    if (head.table !== t || !Array.isArray(head.columns)) { errors.push(`${t}: header does not describe this table.`); continue }
    if (bad.length) { errors.push(`${t}: unknown column(s) ${bad.join(', ')}.`); continue }
    const miss = spec.required.filter(c => !head.columns.includes(c)); if (miss.length) { errors.push(`${t}: required column(s) missing: ${miss.join(', ')}.`); continue }
    const rows: Row[] = []
    for (let i = 1; i < lines.length; i++) {
      let arr: unknown; try { arr = JSON.parse(lines[i]) } catch { errors.push(`${t}: line ${i + 1} is not valid JSON.`); break }
      if (!Array.isArray(arr) || arr.length !== head.columns.length) { errors.push(`${t}: line ${i + 1} has the wrong number of values.`); break }
      const row: Row = {}; head.columns.forEach((c, k) => { row[c] = (arr as unknown[])[k] }); rows.push(row)
    }
    if (rows.length !== info.rows) errors.push(`${t}: manifest says ${info.rows} rows but file has ${rows.length}.`)
    tables[t] = rows
  }
  const ids: Record<string, Set<string>> = {}
  for (const t of ENTITY_TABLES) { ids[t] = new Set(); for (const r of tables[t] ?? []) { const id = String(r.id); if (!UUID.test(id)) errors.push(`${t}: invalid id ${JSON.stringify(id)}.`); else if (ids[t].has(id)) errors.push(`${t}: duplicate id ${id}.`); ids[t].add(id) } }
  const aIds = new Set<string>(); for (const a of tables.attachments ?? []) { const id = String(a.id); if (!UUID.test(id)) errors.push(`attachments: invalid id ${JSON.stringify(id)}.`); else if (aIds.has(id)) errors.push(`attachments: duplicate id ${id}.`); aIds.add(id) }
  for (const r of tables.relations ?? []) if (!UUID.test(String(r.id))) errors.push(`relations: invalid id ${JSON.stringify(r.id)}.`)
  const cycle = (rows: Row[], ref: string, label: string) => { const parent = new Map(rows.map(r => [String(r.id), r[ref] ? String(r[ref]) : null])); for (const id of parent.keys()) { let c: string | null | undefined = id, n = 0; while (c && n++ <= parent.size) c = parent.get(c); if (c) { errors.push(`${label}: circular reference involving ${id}.`); return } } }
  const recs = tables.records ?? []; const kindOf = new Map(recs.map(r => [String(r.id), String(r.kind)]))
  for (const r of recs) { if (!KINDS.includes(String(r.kind))) errors.push(`records: unknown kind "${r.kind}" (${r.id}).`); if (r.module_id && kindOf.get(String(r.module_id)) !== 'module') errors.push(`records: ${r.id} refers to module ${r.module_id} which is not a module in this archive.`) }
  for (const r of tables.tasks ?? []) if (r.parent_id && !ids.tasks.has(String(r.parent_id))) errors.push(`tasks: ${r.id} refers to missing parent task ${r.parent_id}.`)
  cycle(recs, 'module_id', 'records'); cycle(tables.tasks ?? [], 'parent_id', 'tasks')
  for (const a of tables.attachments ?? []) {
    if (!ENTITY_TABLES.includes(a.parent_type as TableName) || !ids[String(a.parent_type)]?.has(String(a.parent_id))) errors.push(`attachments: "${a.filename}" (${a.id}) points to a missing parent ${a.parent_type}/${a.parent_id}.`)
    if (!MIMES.includes(String(a.mime))) errors.push(`attachments: ${a.id} has unsupported type ${a.mime}.`)
    if (!/^[0-9a-f]{64}$/.test(String(a.checksum))) errors.push(`attachments: ${a.id} has an invalid checksum.`)
    if (!(Number(a.byte_size) > 0)) errors.push(`attachments: ${a.id} has an invalid size.`)
  }
  for (const r of tables.relations ?? []) for (const side of ['from', 'to'] as const) if (!ENTITY_TABLES.includes(r[`${side}_type`] as TableName) || !ids[String(r[`${side}_type`])]?.has(String(r[`${side}_id`]))) errors.push(`relations: ${r.id} ${side}-end ${r[`${side}_type`]}/${r[`${side}_id`]} is not in this archive.`)
  // ---- files ----
  const withFiles = new Set<string>()
  for (const f of m.files ?? []) {
    const mm = FILE.exec(f.path)
    if (!mm || mm[1] !== f.attachment_id || mm[2] !== f.variant) { errors.push(`File path ${JSON.stringify(f.path)} does not match its attachment/variant.`); continue }
    if (!aIds.has(f.attachment_id)) { errors.push(`File ${f.path} belongs to an attachment that is not in the archive.`); continue }
    const d = entries.get(f.path); if (!d) { errors.push(`File ${f.path} is listed in the manifest but missing.`); continue }
    if (d.length !== f.bytes) { errors.push(`File ${f.path}: size ${d.length} ≠ manifest ${f.bytes}.`); continue }
    if (await sha256Hex(d) !== f.sha256) { errors.push(`File ${f.path}: checksum mismatch; the file is damaged.`); continue }
    files.set(f.path, d); withFiles.add(f.attachment_id)
  }
  for (const p of entries.keys()) if (p.startsWith('files/') && !(m.files ?? []).some(f => f.path === p)) warnings.push(`Unlisted file ignored: ${p}`)
  const metadataOnly = [...aIds].filter(i => !withFiles.has(i))
  if (metadataOnly.length) warnings.push(`${metadataOnly.length} attachment(s) have no image file in this archive; they will be restored as metadata-only (text, captions and descriptions kept).`)
  if (m.missing_files?.length) warnings.push(`${m.missing_files.length} file(s) could not be read from storage when this archive was made.`)
  return res(m, metadataOnly)
}

export interface ImportPort {
  userId: string
  existingIds(table: TableName): Promise<Set<string>>
  insertRows(table: TableName, rows: Row[]): Promise<{ error?: { message: string } }>
  updateAttachment(id: string, patch: Row): Promise<{ error?: { message: string } }>
  uploadFile(path: string, bytes: Uint8Array, mime: string): Promise<{ error?: { message: string } }>
  removeFiles(paths: string[]): Promise<unknown>
}
export interface RestoreReport { inserted: Record<string, number>; skippedExisting: Record<string, number>; filesUploaded: number; failures: string[]; complete: boolean }
const depthSort = (rows: Row[], ref: string) => { const by = new Map(rows.map(r => [String(r.id), r])); const d = (r: Row): number => r[ref] && by.get(String(r[ref])) ? 1 + d(by.get(String(r[ref]))!) : 0; return [...rows].sort((a, b) => d(a) - d(b)) }
/** Idempotent: existing ids are skipped, so re-running after an interruption completes the restore without duplicates. */
export async function restoreArchive(v: ValidationResult, port: ImportPort, onProgress: (s: string) => void = () => undefined): Promise<RestoreReport> {
  if (!v.ok || !v.manifest) throw new Error('Refusing to restore an archive that failed validation.')
  const rep: RestoreReport = { inserted: {}, skippedExisting: {}, filesUploaded: 0, failures: [], complete: false }
  const insertChunks = async (t: TableName, rows: Row[]): Promise<boolean> => {
    const have = await port.existingIds(t); const fresh = rows.filter(r => !have.has(String(r.id))); rep.skippedExisting[t] = rows.length - fresh.length; rep.inserted[t] = 0
    for (let i = 0; i < fresh.length; i += 100) { const chunk = fresh.slice(i, i + 100); const r = await port.insertRows(t, chunk); if (r.error) { rep.failures.push(`${t}: ${r.error.message}. Nothing after this point was restored; fix the problem and run the import again (already restored rows are skipped).`); return false } rep.inserted[t] += chunk.length }
    return true
  }
  for (const t of ENTITY_TABLES) {
    const rows = v.tables[t]; if (!rows?.length) continue; onProgress(`Restoring ${t}…`)
    const sorted = t === 'records' ? depthSort(rows, 'module_id') : t === 'tasks' ? depthSort(rows, 'parent_id') : rows
    if (!(await insertChunks(t, sorted))) return rep
  }
  const atts = v.tables.attachments ?? []
  if (atts.length) {
    onProgress('Restoring attachment records…'); const have = await port.existingIds('attachments'); const fresh = atts.filter(a => !have.has(String(a.id)))
    rep.skippedExisting.attachments = atts.length - fresh.length; rep.inserted.attachments = 0
    const base = (a: Row): Row => ({ id: a.id, parent_type: a.parent_type, parent_id: a.parent_id, kind: a.kind ?? 'image', status: 'uploading', filename: a.filename, original_name: a.original_name ?? null, caption: a.caption ?? '', alt_text: a.alt_text ?? '', description: a.description ?? '', position: a.position ?? 0, mime: a.mime, byte_size: a.byte_size, width: a.width ?? null, height: a.height ?? null, checksum: a.checksum, extracted_text: a.extracted_text ?? '', extracted_source: a.extracted_source ?? null, extracted_edited: a.extracted_edited ?? false })
    for (let i = 0; i < fresh.length; i += 100) { const chunk = fresh.slice(i, i + 100); const r = await port.insertRows('attachments', chunk.map(base)); if (r.error) { rep.failures.push(`attachments: ${r.error.message}`); return rep } rep.inserted.attachments += chunk.length }
    for (const a of fresh) {
      const id = String(a.id); onProgress(`Restoring files for ${a.filename}…`)
      const mine = (v.manifest.files ?? []).filter(f => f.attachment_id === id); const written: string[] = []; const put: Record<string, string> = {}; let bad: string | null = null
      for (const f of mine) { const path = `${port.userId}/${id}/${f.path.split('/').pop()}`; const r = await port.uploadFile(path, v.files.get(f.path)!, f.mime); if (r.error) { bad = `Upload failed: ${r.error.message}`; break } written.push(path); put[f.variant] = path; rep.filesUploaded++ }
      if (bad) { await port.removeFiles(written); rep.filesUploaded -= written.length; await port.updateAttachment(id, { status: 'failed', error: bad }); rep.failures.push(`${a.filename}: ${bad}`); continue }
      const display = put.display ?? put.original ?? put.thumb ?? null
      if (!display || !(a.status === 'available' || a.status === 'stored')) { await port.updateAttachment(id, { status: 'failed', error: !display ? 'File not included in the imported archive. Re-attach the same file to complete this record.' : String(a.error ?? 'Not available when exported.') }); continue }
      const thumbOnly = !put.display && !put.original
      const u = await port.updateAttachment(id, { status: 'available', error: thumbOnly ? 'Restored from a thumbnail-only archive; the full-size image is not available.' : null, original_path: put.original ?? null, original_bytes: put.original ? a.original_bytes ?? a.byte_size : null, original_retained: !!put.original,
        display_path: display, display_mime: put.display ? a.display_mime : put.original ? a.mime : 'image/webp', display_bytes: put.display ? a.display_bytes : put.original ? a.byte_size : v.files.get(mine.find(f => f.variant === 'thumb')!.path)!.length, thumb_path: put.thumb ?? null, thumb_bytes: put.thumb ? a.thumb_bytes : null, optimized: !!a.optimized || thumbOnly })
      if (u.error) { await port.removeFiles(written); await port.updateAttachment(id, { status: 'failed', error: u.error.message }); rep.failures.push(`${a.filename}: ${u.error.message}`) }
    }
  }
  const rels = v.tables.relations ?? []
  if (rels.length) { onProgress('Restoring relationships…'); if (!(await insertChunks('relations', rels))) return rep }
  rep.complete = rep.failures.length === 0
  return rep
}
