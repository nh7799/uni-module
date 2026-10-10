import test from 'node:test'; import assert from 'node:assert/strict'
import { crc32, readZip, writeZip } from '../lib/archive/zip'
import { buildArchive, type ExportSource } from '../lib/archive/export'
import { restoreArchive, validateArchive, type ImportPort } from '../lib/archive/import'
import { TABLES, type Row, type TableName } from '../lib/archive/schema'
import { sha256Hex } from '../lib/attachments/sniff'
import { png } from './fakes'
const U = 'aaaaaaaa-0000-0000-0000-000000000001', id = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const te = new TextEncoder(), td = new TextDecoder()
const orig = png(800, 600, 3000, 1), disp = png(800, 600, 1200, 2), thumb = png(100, 80, 200, 3)
const data = (): Record<TableName, Row[]> => ({
  records: [{ id: id(1), kind: 'module', title: 'Algorithmes — 算法 ✓', body: '', meta: { code: '6COM' }, tags: [], created_at: '2026-01-01T00:00:00Z' },
    { id: id(2), kind: 'lecture', title: 'Sorting / "quick": sort?', body: 'Pivot → partition.\nÉtude 日本語', meta: {}, occurred_on: '2026-02-03', module_id: id(1), tags: ['sorting'], created_at: '2026-01-02T00:00:00Z' }],
  tasks: [{ id: id(10), title: 'Lab', tier: 'core', status: 'todo' }, { id: id(11), title: 'Sub', tier: 'core', status: 'done', parent_id: id(10) }],
  events: [{ id: id(20), title: 'Deadline', date: '2026-03-01', kind: 'official', done: false }], decisions: [], blockers: [], projects: [], daily_records: [],
  attachments: [{ id: id(30), parent_type: 'records', parent_id: id(2), kind: 'image', status: 'available', filename: 'Whiteboard', caption: 'cap', alt_text: 'a board', description: 'Shows quicksort', mime: 'image/png', byte_size: orig.length, checksum: 'a'.repeat(64), position: 0, extracted_text: 'while i < j', extracted_source: 'ocr', extracted_edited: true, original_retained: true, optimized: true, display_mime: 'image/webp', display_bytes: disp.length, thumb_bytes: thumb.length, original_bytes: orig.length,
    original_path: `${U}/${id(30)}/original.png`, display_path: `${U}/${id(30)}/display.webp`, thumb_path: `${U}/${id(30)}/thumb.webp` },
    { id: id(31), parent_type: 'tasks', parent_id: id(11), kind: 'image', status: 'pending_deletion', filename: 'gone', mime: 'image/png', byte_size: 5, checksum: 'b'.repeat(64), position: 0 }],
  relations: [{ id: id(40), from_type: 'records', from_id: id(2), to_type: 'tasks', to_id: id(10), label: 'prepares for' }] })
const files: Record<string, Uint8Array> = { [`${U}/${id(30)}/original.png`]: orig, [`${U}/${id(30)}/display.webp`]: disp, [`${U}/${id(30)}/thumb.webp`]: thumb }
const source = (d = data(), f = files): ExportSource => ({ fetchAll: async t => d[t], download: async p => f[p] ?? null })
const all = { all: true, moduleIds: [] as string[] }
class Port implements ImportPort {
  userId = 'bbbbbbbb-0000-0000-0000-000000000002'; db = new Map<string, Map<string, Row>>(); objects = new Map<string, Uint8Array>(); failTable: string | null = null; failUpload = false
  tbl(t: string) { if (!this.db.has(t)) this.db.set(t, new Map()); return this.db.get(t)! }
  async existingIds(t: TableName) { return new Set(this.tbl(t).keys()) }
  async insertRows(t: TableName, rows: Row[]) { if (this.failTable === t) return { error: { message: 'boom' } }; for (const r of rows) { if (t === 'records' && r.module_id && !this.tbl('records').has(String(r.module_id))) return { error: { message: 'fk violation' } }; this.tbl(t).set(String(r.id), { ...r }) } return {} }
  async updateAttachment(i: string, p: Row) { Object.assign(this.tbl('attachments').get(i)!, p); return {} }
  async uploadFile(p: string, b: Uint8Array) { if (this.failUpload) return { error: { message: 'quota' } }; this.objects.set(p, b); return {} }
  async removeFiles(ps: string[]) { ps.forEach(p => this.objects.delete(p)) }
}
const build = async (o: Partial<Parameters<typeof buildArchive>[1]> = {}, src = source()) => buildArchive(src, { contents: 'both', scope: all, include: { originals: true, optimized: true, thumbnails: true }, now: new Date('2026-10-10T09:00:00Z'), ...o })
const open = async (zip: Uint8Array) => validateArchive(await readZip(zip))

test('zip roundtrip preserves bytes and Unicode; detects corruption', async () => {
  const z = await writeZip([{ path: 'a/日本語-é.txt', data: te.encode('héllo '.repeat(500)) }, { path: 'b.bin', data: orig, compress: false }, { path: 'empty.txt', data: new Uint8Array(0) }])
  const m = await readZip(z); assert.equal(td.decode(m.get('a/日本語-é.txt')), 'héllo '.repeat(500)); assert.deepEqual(m.get('b.bin'), orig); assert.equal(m.get('empty.txt')!.length, 0)
  assert.ok(z.length < 3000 + orig.length, 'text part deflated'); assert.equal(crc32(te.encode('123456789')), 0xcbf43926)
  const bad = z.slice(); bad[60] ^= 0xff; await assert.rejects(readZip(bad)); await assert.rejects(readZip(te.encode('not a zip at all, definitely not')))
})
test('export → validate → restore into another account round-trips everything, relationships included', async () => {
  const { zip, manifest, report } = await build(); assert.equal(manifest.schema_version, '1.0'); assert.equal(manifest.encoding, 'utf-8')
  assert.equal(report.counts.attachments, 1, 'pending_deletion attachments are not exported'); assert.equal(report.files, 3); assert.equal(report.zipBytes, zip.length)
  assert.ok(report.uncompressedBytes > report.zipBytes - 1 && report.textStoredBytes < report.textRawBytes, 'text is compressed')
  assert.equal(report.imageBytes, orig.length + disp.length + thumb.length)
  const v = await open(zip); assert.deepEqual(v.errors, []); assert.ok(v.ok)
  const port = new Port(); const rep = await restoreArchive(v, port); assert.deepEqual(rep.failures, []); assert.ok(rep.complete)
  assert.equal(port.tbl('records').size, 2); assert.equal(port.tbl('tasks').size, 2); assert.equal(port.tbl('relations').size, 1)
  const rec = port.tbl('records').get(id(2))!; assert.equal(rec.title, 'Sorting / "quick": sort?'); assert.equal(rec.body, 'Pivot → partition.\nÉtude 日本語'); assert.equal(port.tbl('records').get(id(1))!.title, 'Algorithmes — 算法 ✓')
  const a = port.tbl('attachments').get(id(30))!; assert.equal(a.status, 'available'); assert.equal(a.display_path, `${port.userId}/${id(30)}/display.webp`); assert.equal(a.caption, 'cap'); assert.equal(a.extracted_source, 'ocr'); assert.equal(a.extracted_edited, true)
  assert.deepEqual(port.objects.get(`${port.userId}/${id(30)}/original.png`), orig); assert.equal(port.objects.size, 3)
  const again = await restoreArchive(v, port); assert.equal(again.inserted.records, 0); assert.equal(again.skippedExisting.records, 2); assert.equal(port.tbl('attachments').size, 1, 're-running is idempotent')
})
test('text-only export restores attachments as metadata-only without losing descriptions', async () => {
  const { zip, report } = await build({ include: { originals: false, optimized: false, thumbnails: false } }); assert.equal(report.files, 0)
  const v = await open(zip); assert.ok(v.ok); assert.equal(v.metadataOnly.length, 1); const port = new Port(); await restoreArchive(v, port)
  const a = port.tbl('attachments').get(id(30))!; assert.equal(a.status, 'failed'); assert.match(String(a.error), /not included/); assert.equal(a.description, 'Shows quicksort'); assert.equal(a.extracted_text, 'while i < j')
})
test('file-variant choices are honoured and sizes measured', async () => {
  const t = await build({ include: { originals: false, optimized: false, thumbnails: true } }); assert.equal(t.report.files, 1); assert.equal(t.report.imageBytes, thumb.length)
  const o = await build({ include: { originals: true, optimized: false, thumbnails: false } }); assert.equal(o.report.imageBytes, orig.length)
  const v = await open(t.zip); const port = new Port(); await restoreArchive(v, port); assert.match(String(port.tbl('attachments').get(id(30))!.error), /thumbnail-only/)
})
test('readable archive: Markdown organised by module/type/date, relative image links, relations, machine-text labelled', async () => {
  const { zip } = await build({ contents: 'readable' }); const m = await readZip(zip)
  const path = [...m.keys()].find(k => k.includes('lecture/2026-02-03'))!; assert.ok(path.startsWith('readable/Algorithmes-—-算法-✓/lecture/'), path)
  const md = td.decode(m.get(path)); assert.match(md, /!\[a board\]\((\.\.\/){3}files\/10000000-0000-4000-8000-000000000030\/display\.webp\)/); assert.match(md, /prepares for → Lab/); assert.match(md, /machine-extracted by OCR, then edited by you/); assert.match(md, /Étude 日本語/)
  assert.ok(![...m.keys()].some(k => k.startsWith('data/')), 'no compact data in readable-only export'); assert.ok(!md.includes('base64'))
  assert.ok(m.has('files/10000000-0000-4000-8000-000000000030/display.webp')); const v = await validateArchive(m); assert.ok(!v.ok && /readable-only/.test(v.errors[0]))
})
test('module scope exports only that module with its records, attachments and internal relations', async () => {
  const d = data(); d.records.push({ id: id(3), kind: 'module', title: 'Other', body: '' }, { id: id(4), kind: 'note', title: 'x', body: '', module_id: id(3) })
  d.relations.push({ id: id(41), from_type: 'records', from_id: id(2), to_type: 'records', to_id: id(4), label: 'see also' })
  const { zip, report } = await build({ scope: { all: false, moduleIds: [id(1)] } }, source(d)); assert.equal(report.counts.records, 2); assert.equal(report.counts.tasks, 0); assert.equal(report.counts.relations, 0); assert.equal(report.droppedRelations, 2)
  assert.ok((await open(zip)).ok)
})
test('validation rejects tampering, bad references, unsafe paths and unknown versions', async () => {
  const { zip } = await build(); const base = await readZip(zip)
  const mutate = async (f: (m: Map<string, Uint8Array>) => void | Promise<void>) => { const m = new Map(base); await f(m); return validateArchive(m) }
  assert.match((await mutate(m => { m.delete('manifest.json') })).errors[0], /manifest/)
  assert.match((await mutate(m => { const x = JSON.parse(td.decode(m.get('manifest.json'))); x.schema_version = '9.0'; m.set('manifest.json', te.encode(JSON.stringify(x))) })).errors[0], /Unsupported schema/)
  assert.match((await mutate(m => { m.set('data/records.jsonl', te.encode(td.decode(m.get('data/records.jsonl')).replace('Pivot', 'Hacked'))) })).errors.join(), /checksum mismatch/)
  assert.match((await mutate(m => { const k = [...m.keys()].find(k => k.endsWith('display.webp'))!; const b = m.get(k)!.slice(); b[10] ^= 1; m.set(k, b) })).errors.join(), /checksum mismatch/)
  assert.match((await mutate(m => { m.set('../evil.txt', new Uint8Array(1)) })).errors.join(), /Unsafe file path/)
  assert.match((await mutate(m => { m.set('files/x\\y', new Uint8Array(1)) })).errors.join(), /Unsafe/)
  const rewrite = async (m: Map<string, Uint8Array>, t: string, f: (rows: Row[]) => void) => { const lines = td.decode(m.get(`data/${t}.jsonl`)).trim().split('\n'); const cols: string[] = JSON.parse(lines[0]).columns; const rows = lines.slice(1).map(l => Object.fromEntries((JSON.parse(l) as unknown[]).map((v, i) => [cols[i], v]))); f(rows)
    const bytes = te.encode([lines[0], ...rows.map(r => JSON.stringify(cols.map(c => r[c] ?? null)))].join('\n') + '\n'); m.set(`data/${t}.jsonl`, bytes); const mf = JSON.parse(td.decode(m.get('manifest.json'))); mf.tables[t].sha256 = await sha256Hex(bytes); m.set('manifest.json', te.encode(JSON.stringify(mf))) }
  assert.match((await mutate(m => rewrite(m, 'relations', r => { r[0].to_id = id(99) }))).errors.join(), /not in this archive/)
  assert.match((await mutate(m => rewrite(m, 'attachments', r => { r[0].parent_id = id(99) }))).errors.join(), /missing parent/)
  assert.match((await mutate(m => rewrite(m, 'records', r => { r[1].module_id = id(2) }))).errors.join(), /not a module/)
  assert.match((await mutate(m => rewrite(m, 'records', r => { r[1].id = r[0].id }))).errors.join(), /duplicate id/)
  assert.match((await mutate(m => rewrite(m, 'tasks', r => { r[0].parent_id = id(11) }))).errors.join(), /circular/)
  assert.match((await mutate(m => rewrite(m, 'records', r => { r[0].kind = 'weird' }))).errors.join(), /unknown kind/)
  assert.match((await mutate(m => { const f = [...m.keys()].find(k => k.endsWith('thumb.webp'))!; m.delete(f) })).errors.join(), /missing/)
})
test('restore refuses invalid archives and stops safely on partial failure, then completes on re-run', async () => {
  const { zip } = await build(); const v = await open(zip); const bad = { ...v, ok: false }; await assert.rejects(restoreArchive(bad, new Port()))
  const port = new Port(); port.failTable = 'tasks'; const r1 = await restoreArchive(v, port); assert.equal(r1.complete, false); assert.match(r1.failures[0], /run the import again/); assert.equal(port.tbl('records').size, 2); assert.equal(port.tbl('attachments').size, 0)
  port.failTable = null; const r2 = await restoreArchive(v, port); assert.ok(r2.complete); assert.equal(port.tbl('tasks').size, 2); assert.equal(port.tbl('records').size, 2); assert.equal(port.tbl('attachments').size, 1)
  const p2 = new Port(); p2.failUpload = true; const r3 = await restoreArchive(v, p2); assert.equal(r3.complete, false); assert.equal(p2.tbl('attachments').get(id(30))!.status, 'failed'); assert.equal(p2.objects.size, 0)
})
test('every exported column exists in the documented schema (no drift)', () => { for (const [t, d] of Object.entries(TABLES)) { assert.ok(!d.cols.includes('user_id'), t); for (const r of d.required) assert.ok(d.cols.includes(r), `${t}.${r}`) } })
