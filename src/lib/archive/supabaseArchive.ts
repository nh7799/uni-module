import { supabase } from '../supabase'
import { storagePort } from '../attachments/supabasePorts'
import type { ExportSource } from './export'
import type { ImportPort } from './import'
import type { Row, TableName } from './schema'
export async function fetchAllRows(table: string, columns = '*'): Promise<Row[]> {
  const out: Row[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from(table).select(columns).order('id').range(from, from + 999)
    if (error) throw new Error(`Could not read ${table}: ${error.message}`)
    out.push(...((data ?? []) as unknown as Row[])); if ((data?.length ?? 0) < 1000) break
  }
  return out
}
export const exportSource: ExportSource = { fetchAll: t => fetchAllRows(t), download: p => storagePort.download(p) }
export const importPort = (userId: string): ImportPort => ({
  userId,
  async existingIds(t: TableName) { return new Set((await fetchAllRows(t, 'id')).map(r => String(r.id))) },
  async insertRows(t, rows) { const clean = rows.map(r => Object.fromEntries(Object.entries(r).filter(([, v]) => v !== null && v !== undefined))); const { error } = await supabase.from(t).insert(clean); return error ? { error: { message: error.message } } : {} },
  async updateAttachment(id, patch) { const { error } = await supabase.from('attachments').update(patch).eq('id', id); return error ? { error: { message: error.message } } : {} },
  async uploadFile(path, bytes, mime) { return storagePort.upload(path, { bytes, mime }) },
  removeFiles: paths => storagePort.remove(paths) })
export async function logEvent(kind: 'export' | 'verify' | 'import', v: { format?: string; ok: boolean; bytes?: number; uncompressed_bytes?: number; record_count?: number; detail?: Record<string, unknown> }) {
  const { error } = await supabase.from('export_log').insert({ kind, ...v }); return error?.message ?? null
}
