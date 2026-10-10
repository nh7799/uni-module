import test from 'node:test'; import assert from 'node:assert/strict'
import { DEFAULT_CONFIG } from '../lib/attachments/config'
import { createAttachmentService } from '../lib/attachments/service'
import { reconcile, repair } from '../lib/attachments/maintenance'
import { UploadError, type Parent } from '../lib/attachments/types'
import { FakeDb, FakeProcessor, FakeStorage, USER, file, png, uid } from './fakes'
function setup(cfg = {}) {
  const db = new FakeDb(), storage = new FakeStorage(), processor = new FakeProcessor(); const parent: Parent = db.addParent({ type: 'records', id: uid() })
  const svc = createAttachmentService({ db, storage, processor, cfg: { ...DEFAULT_CONFIG, processingTimeoutMs: 1000, ...cfg }, userId: USER, sleep: async () => undefined, newId: uid })
  return { db, storage, processor, parent, svc }
}
const code = async (p: Promise<unknown>) => p.then(() => 'no error', (e: UploadError) => e.code)
test('happy path: files stored under user/attachment folder, metadata recorded, available only at the end', async () => {
  const { db, storage, parent, svc } = setup(); const stages: string[] = []
  const r = await svc.upload(parent, file(png(3000, 2000, 5000)), { onStage: s => stages.push(s) })
  assert.equal(r.row.status, 'available'); assert.equal(r.duplicate, false); assert.deepEqual(stages, ['validating', 'saving record', 'processing', 'uploading', 'verifying', 'done'])
  assert.ok(r.row.display_path!.startsWith(`${USER}/${r.row.id}/display.`)); assert.ok(r.row.thumb_path); assert.ok(r.row.original_retained && r.row.original_path)
  assert.equal(r.row.checksum.length, 64); assert.equal(r.row.mime, 'image/png'); assert.equal(storage.objects.size, 3); assert.ok(r.row.optimized)
  assert.equal(db.rows.size, 1)
})
test('originals can be discarded by configuration; display copy stays', async () => {
  const { storage, parent, svc } = setup({ retainOriginals: false }); const r = await svc.upload(parent, file(png(100, 100, 3000)))
  assert.equal(r.row.original_retained, false); assert.equal(r.row.original_path, null); assert.equal(storage.objects.size, 2)
})
test('invalid files never create a row or touch storage', async () => {
  const { db, storage, parent, svc } = setup()
  assert.equal(await code(svc.upload(parent, file(new TextEncoder().encode('<svg onload=alert(1)>................'), 'x.png'))), 'unsupported')
  assert.equal(await code(svc.upload(parent, file(png(40000, 40000)))), 'too_many_pixels')
  assert.equal(await code(svc.upload(parent, { name: 'a.png', size: 999, type: 'image/png', bytes: async () => png(10, 10) })), 'read_failed')
  assert.equal(db.rows.size, 0); assert.equal(storage.uploads.length, 0)
})
test('unauthorized: attaching to a parent you do not own fails with no stored files', async () => {
  const { db, storage, svc } = setup(); const foreign: Parent = { type: 'records', id: uid() }
  assert.equal(await code(svc.upload(foreign, file(png(50, 50, 500)))), 'db'); assert.equal(db.rows.size, 0); assert.equal(storage.uploads.length, 0)
})
test('failed upload: no false success, files compensated, row marked failed, same file resumes without duplicate', async () => {
  const { db, storage, parent, svc } = setup(); const f = file(png(200, 200, 4000)); storage.uploadFailures = 99
  assert.equal(await code(svc.upload(parent, f)), 'failed')
  const row = [...db.rows.values()][0]; assert.equal(row.status, 'failed'); assert.match(row.error!, /failed/); assert.equal(storage.objects.size, 0); assert.equal(row.display_path, null)
  storage.uploadFailures = 0; const r = await svc.upload(parent, f)
  assert.equal(r.row.status, 'available'); assert.equal(r.row.id, row.id); assert.equal(db.rows.size, 1)
})
test('transient storage errors are retried and do not create duplicates', async () => {
  const { db, storage, parent, svc } = setup(); storage.uploadFailures = 2
  const r = await svc.upload(parent, file(png(200, 200, 4000))); assert.equal(r.row.status, 'available'); assert.equal(db.rows.size, 1); assert.equal(storage.objects.size, 3)
})
test('duplicate retry of an attached file returns the existing record', async () => {
  const { db, parent, svc } = setup(); const f = file(png(200, 200, 4000)); const a = await svc.upload(parent, f); const b = await svc.upload(parent, f)
  assert.equal(b.duplicate, true); assert.equal(b.row.id, a.row.id); assert.equal(db.rows.size, 1)
})
test('a lost insert race (unique violation) resumes the winner instead of failing', async () => {
  const { db, parent, svc } = setup(); const f = file(png(200, 200, 4000)); const real = db.findByChecksum.bind(db); let first = true
  const a = await svc.upload(parent, f); db.rows.get(a.row.id)!.status = 'failed'
  db.findByChecksum = async (p, c) => { if (first) { first = false; return null } return real(p, c) }   // first lookup misses, insert then hits the unique index
  const b = await svc.upload(parent, f); assert.equal(b.row.id, a.row.id); assert.equal(db.rows.size, 1)
})
test('failed metadata write: stored files are removed and the row is marked failed', async () => {
  const { db, storage, parent, svc } = setup(); db.failNextUpdate = p => p.status === 'stored'
  assert.equal(await code(svc.upload(parent, file(png(200, 200, 4000)))), 'failed'); assert.equal(storage.objects.size, 0); assert.equal([...db.rows.values()][0].status, 'failed')
})
test('file missing right after upload is detected', async () => {
  const { storage, parent, svc, db } = setup(); storage.hideAfterUpload = true
  assert.equal(await code(svc.upload(parent, file(png(200, 200, 4000)))), 'failed'); assert.match([...db.rows.values()][0].error!, /could not be found/)
})
test('stored but not retrievable is not reported as success', async () => {
  const { storage, parent, svc, db } = setup(); storage.signedFails = true
  assert.equal(await code(svc.upload(parent, file(png(200, 200, 4000)))), 'failed'); assert.equal([...db.rows.values()][0].status, 'failed'); assert.equal(storage.objects.size, 0)
})
test('interrupted/failed processing keeps the original and offers retry', async () => {
  const { db, storage, processor, parent, svc } = setup({ retainOriginals: false }); processor.mode = 'throw'
  assert.equal(await code(svc.upload(parent, file(png(200, 200, 4000)))), 'processing_failed')
  const row = [...db.rows.values()][0]; assert.equal(row.status, 'failed'); assert.ok(row.original_path); assert.equal(storage.objects.size, 1); assert.equal(row.display_path, null)
  processor.mode = 'ok'; const fixed = await svc.retryProcessing(row.id); assert.equal(fixed!.status, 'available'); assert.ok(fixed!.thumb_path); assert.equal(fixed!.error, null)
})
test('processing timeout stops the job and reports it', async () => {
  const { db, processor, parent, svc } = setup({ processingTimeoutMs: 1000 }); processor.mode = 'hang'
  assert.equal(await code(svc.upload(parent, file(png(200, 200, 4000)))), 'processing_failed'); assert.match([...db.rows.values()][0].error!, /longer than/)
})
test('replace keeps the old attachment until the new one is safely stored', async () => {
  const { db, storage, parent, svc } = setup(); const old = (await svc.upload(parent, file(png(200, 200, 4000, 1)), { filename: 'Diagram' })).row
  storage.failPathPart = 'display'; assert.equal(await code(svc.replace(old.id, file(png(200, 200, 4000, 2)))), 'failed')
  assert.equal((await db.get(old.id))!.status, 'available'); assert.ok(storage.objects.has(old.display_path!))
  storage.failPathPart = null; await db.update(old.id, { description: 'a tree' }); const r = await svc.replace(old.id, file(png(200, 200, 4000, 3)))
  assert.equal(r.row.filename, 'Diagram'); assert.equal(r.row.description, 'a tree'); assert.equal(await db.get(old.id), null); assert.equal(storage.objects.has(old.display_path!), false)
  assert.equal(await code(svc.replace(r.row.id, file(png(200, 200, 4000, 3)))), 'same_file')
})
test('delete: failing storage leaves a pending_deletion row that purge later removes', async () => {
  const { db, storage, parent, svc } = setup(); const a = (await svc.upload(parent, file(png(200, 200, 4000)))).row; storage.removeFails = true
  const r = await svc.remove(a.id); assert.equal(r.purged, false); assert.equal((await db.get(a.id))!.status, 'pending_deletion'); assert.equal((await db.list(parent)).length, 0)
  storage.removeFails = false; assert.deepEqual(await svc.purgePending(parent), { purged: 1, failed: 0 }); assert.equal(db.rows.size, 0); assert.equal(storage.objects.size, 0)
})
test('reorder persists positions', async () => {
  const { db, parent, svc } = setup(); const a = (await svc.upload(parent, file(png(100, 100, 3000, 1)))).row, b = (await svc.upload(parent, file(png(100, 100, 3000, 2)))).row
  await svc.reorder([b.id, a.id]); assert.deepEqual((await db.list(parent)).map(x => x.id), [b.id, a.id])
})
test('reconcile finds orphans, stuck, failed, missing files; repair is safe', async () => {
  const { db, storage, parent, svc } = setup(); const ok = (await svc.upload(parent, file(png(200, 200, 4000, 1)))).row
  storage.objects.delete(ok.thumb_path!)                                                // a file lost from storage
  storage.objects.set(`${USER}/${uid()}/display.webp`, { bytes: new Uint8Array(5), mime: 'image/webp' })  // orphan folder
  const stuck = await db.insert({ id: uid(), parent_type: 'records', parent_id: parent.id, kind: 'image', status: 'uploading', filename: 's', original_name: 's', mime: 'image/png', byte_size: 5, checksum: 'b'.repeat(64), position: 9, updated_at: '2020-01-01T00:00:00Z' })
  const maint = { listAll: async () => [...db.rows.values()], listFolderIds: async () => [...new Set([...storage.objects.keys()].map(k => k.split('/')[1]))],
    listFiles: async (id: string) => [...storage.objects.entries()].filter(([k]) => k.split('/')[1] === id).map(([path, o]) => ({ path, bytes: o.bytes.length })) }
  const rep = await reconcile(maint, { deep: true, now: Date.parse('2026-01-01')})
  assert.equal(rep.orphanFolders.length, 1); assert.equal(rep.stuck.length, 1); assert.equal(rep.missingFiles.length, 1); assert.equal(rep.missingFiles[0].variant, 'thumb')
  const out = await repair(maint, db, storage, rep, svc.purgeOne); assert.deepEqual([out.markedMissing, out.orphansRemoved, out.stuckFailed, out.errors.length], [1, 1, 1, 0])
  assert.ok(db.rows.has(ok.id), 'rows with missing files are kept (marked failed), never silently deleted'); assert.equal((await db.get(ok.id))!.status, 'failed'); assert.equal((await db.get(stuck.row!.id))!.status, 'failed')
})
