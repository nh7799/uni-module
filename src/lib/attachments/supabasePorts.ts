import { supabase } from '../supabase'
import type { AttachmentRow, DbPort, Parent, StoragePort } from './types'
import type { MaintPort } from './maintenance'
const BUCKET = 'attachments'
const err = (e: { code?: string; message: string } | null) => e ? { error: { code: e.code, message: e.message } } : {}
export const dbPort: DbPort = {
  async insert(row) { const { data, error } = await supabase.from('attachments').insert(row).select().single(); return error ? err(error) : { row: data as AttachmentRow } },
  async findByChecksum(p: Parent, checksum) { const { data } = await supabase.from('attachments').select('*').eq('parent_type', p.type).eq('parent_id', p.id).eq('checksum', checksum).neq('status', 'pending_deletion').maybeSingle(); return (data as AttachmentRow) ?? null },
  async get(id) { const { data } = await supabase.from('attachments').select('*').eq('id', id).maybeSingle(); return (data as AttachmentRow) ?? null },
  async update(id, patch) { const { error } = await supabase.from('attachments').update(patch).eq('id', id); return err(error) },
  async list(p, includeInactive) { let q = supabase.from('attachments').select('*').eq('parent_type', p.type).eq('parent_id', p.id).order('position').order('created_at'); if (!includeInactive) q = q.neq('status', 'pending_deletion'); const { data } = await q; return (data as AttachmentRow[]) ?? [] },
  async delete(id) { const { error } = await supabase.from('attachments').delete().eq('id', id); return err(error) } }
export const storagePort: StoragePort = {
  async upload(path, f) { const { error } = await supabase.storage.from(BUCKET).upload(path, new Blob([f.bytes as BlobPart], { type: f.mime }), { upsert: true, contentType: f.mime, cacheControl: '3600' }); return err(error) },
  async download(path) { const { data, error } = await supabase.storage.from(BUCKET).download(path); return error || !data ? null : new Uint8Array(await data.arrayBuffer()) },
  async remove(paths) { const { error } = await supabase.storage.from(BUCKET).remove(paths); return err(error) },
  async exists(path, bytes) { const i = path.lastIndexOf('/'); const { data, error } = await supabase.storage.from(BUCKET).list(path.slice(0, i), { search: path.slice(i + 1), limit: 5 }); const f = data?.find(x => x.name === path.slice(i + 1)); return !error && !!f && (bytes == null || (f.metadata as { size?: number } | null)?.size === bytes) },
  async signedUrl(path, ttl) { const { data } = await supabase.storage.from(BUCKET).createSignedUrl(path, ttl); return data?.signedUrl ?? null } }
export const maintPort = (userId: string): MaintPort => ({
  async listAll() { const { data } = await supabase.from('attachments').select('*'); return (data as AttachmentRow[]) ?? [] },
  async listFolderIds() { const ids: string[] = []; for (let o = 0; ; o += 1000) { const { data } = await supabase.storage.from(BUCKET).list(userId, { limit: 1000, offset: o }); if (!data?.length) break; ids.push(...data.map(d => d.name)); if (data.length < 1000) break } return ids },
  async listFiles(id) { const { data } = await supabase.storage.from(BUCKET).list(`${userId}/${id}`, { limit: 100 }); return (data ?? []).map(f => ({ path: `${userId}/${id}/${f.name}`, bytes: (f.metadata as { size?: number } | null)?.size ?? -1 })) } })
