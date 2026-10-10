import type { AttachmentRow, DbPort, StoragePort } from './types'
export interface MaintPort {
  listAll(): Promise<AttachmentRow[]>                                   // every attachment of the user, any status
  listFolderIds(): Promise<string[]>                                    // attachment ids that have a storage folder
  listFiles(id: string): Promise<{ path: string; bytes: number }[]>     // files stored for one attachment
}
export interface ReconcileReport {
  checkedAt: string; deep: boolean; totalRows: number
  stuck: AttachmentRow[]; failed: AttachmentRow[]; pending: AttachmentRow[]
  orphanFolders: string[]                                               // storage folders with no metadata row
  missingFiles: { id: string; filename: string; path: string; variant: string }[]
}
export const STUCK_AFTER_MS = 60 * 60 * 1000
const variants = (r: AttachmentRow): [string, string | null, number | null][] => [['original', r.original_path, r.original_bytes], ['display', r.display_path, r.display_bytes], ['thumb', r.thumb_path, r.thumb_bytes]]
export async function reconcile(m: MaintPort, opts: { deep?: boolean; now?: number } = {}): Promise<ReconcileReport> {
  const now = opts.now ?? Date.now(); const rows = await m.listAll(); const ids = new Set(rows.map(r => r.id))
  const orphanFolders = (await m.listFolderIds()).filter(i => !ids.has(i))
  const missingFiles: ReconcileReport['missingFiles'] = []
  if (opts.deep) for (const r of rows.filter(r => r.status === 'available' || r.status === 'stored')) {
    const have = new Map((await m.listFiles(r.id)).map(f => [f.path, f.bytes]))
    for (const [v, p, b] of variants(r)) if (p && (!have.has(p) || (b != null && have.get(p) !== b))) missingFiles.push({ id: r.id, filename: r.filename, path: p, variant: v })
  }
  return { checkedAt: new Date(now).toISOString(), deep: !!opts.deep, totalRows: rows.length, orphanFolders, missingFiles,
    stuck: rows.filter(r => (r.status === 'uploading' || r.status === 'processing') && now - Date.parse(r.updated_at ?? r.created_at ?? '') > STUCK_AFTER_MS),
    failed: rows.filter(r => r.status === 'failed'), pending: rows.filter(r => r.status === 'pending_deletion') }
}
export interface RepairResult { markedMissing: number; orphansRemoved: number; stuckFailed: number; purged: number; errors: string[] }
/** Safe repairs only: rows are never deleted for missing files (they are marked failed so you can re-attach); orphan files are removed. */
export async function repair(m: MaintPort, db: DbPort, storage: StoragePort, rep: ReconcileReport, purge: (r: AttachmentRow) => Promise<boolean>): Promise<RepairResult> {
  const out: RepairResult = { markedMissing: 0, orphansRemoved: 0, stuckFailed: 0, purged: 0, errors: [] }
  for (const id of new Set(rep.missingFiles.map(f => f.id))) {
    const r = await db.update(id, { status: 'failed', error: 'A stored file is missing from storage. Re-attach the file (the same file resumes this record).' })
    r.error ? out.errors.push(`${id}: ${r.error.message}`) : out.markedMissing++
  }
  for (const id of rep.orphanFolders) {
    const files = await m.listFiles(id); const x = files.length ? await storage.remove(files.map(f => f.path)) : {}
    'error' in x && x.error ? out.errors.push(`orphan ${id}: ${x.error.message}`) : out.orphansRemoved++
  }
  for (const r of rep.stuck) {
    const files = await m.listFiles(r.id); if (files.length) await storage.remove(files.map(f => f.path))
    const u = await db.update(r.id, { status: 'failed', error: 'The upload was interrupted and abandoned. Re-attach the file to retry.', original_path: null, display_path: null, thumb_path: null, original_retained: false })
    u.error ? out.errors.push(`${r.id}: ${u.error.message}`) : out.stuckFailed++
  }
  for (const r of rep.pending) (await purge(r)) ? out.purged++ : out.errors.push(`${r.filename}: could not remove files yet`)
  return out
}
