import { supabase } from './supabase'
import { PARENT_TYPES, type Parent, type ParentType } from './attachments/types'
export interface Rel { id: string; from_type: ParentType; from_id: string; to_type: ParentType; to_id: string; label: string }
export interface Linked { rel: Rel; dir: 'out' | 'in'; other: Parent; title: string }
export const LABELS = ['related to', 'explains', 'prepares for', 'assessed by', 'evidence for', 'depends on', 'revision of', 'cites', 'part of', 'submitted as', 'follows from']
export const ROUTE: Record<ParentType, (id: string) => string> = { records: id => `/library?open=${id}`, tasks: () => '/tasks', events: () => '/timeline', decisions: () => '/decisions', blockers: () => '/blockers', projects: () => '/projects', daily_records: () => '/today' }
export const TYPE_LABEL: Record<ParentType, string> = { records: 'Record', tasks: 'Task', events: 'Event', decisions: 'Decision', blockers: 'Blocker', projects: 'Project', daily_records: 'Daily record' }
const titleCol = (t: ParentType) => t === 'decisions' ? 'question' : t === 'daily_records' ? 'day' : 'title'
export async function titlesFor(refs: Parent[]): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  for (const t of PARENT_TYPES) { const ids = [...new Set(refs.filter(r => r.type === t).map(r => r.id))]; if (!ids.length) continue
    const { data } = await supabase.from(t).select(`id, ${titleCol(t)}`).in('id', ids); (data as unknown as Record<string, string>[] | null)?.forEach(r => out.set(`${t}:${r.id}`, r[titleCol(t)])) }
  return out
}
export async function loadLinks(p: Parent): Promise<Linked[]> {
  const [a, b] = await Promise.all([supabase.from('relations').select('*').eq('from_type', p.type).eq('from_id', p.id), supabase.from('relations').select('*').eq('to_type', p.type).eq('to_id', p.id)])
  const items = [...((a.data ?? []) as Rel[]).map(rel => ({ rel, dir: 'out' as const, other: { type: rel.to_type, id: rel.to_id } })), ...((b.data ?? []) as Rel[]).map(rel => ({ rel, dir: 'in' as const, other: { type: rel.from_type, id: rel.from_id } }))]
  const titles = await titlesFor(items.map(i => i.other)); return items.map(i => ({ ...i, title: titles.get(`${i.other.type}:${i.other.id}`) ?? '(missing record)' }))
}
export async function searchTargets(q: string, exclude: Parent): Promise<{ ref: Parent; title: string }[]> {
  const s = q.trim().replace(/[%,()]/g, ' '); if (s.length < 2) return []
  const res = await Promise.all(PARENT_TYPES.filter(t => t !== 'daily_records').map(async t => { const { data } = await supabase.from(t).select(`id, ${titleCol(t)}`).ilike(titleCol(t), `%${s}%`).limit(6); return ((data ?? []) as unknown as Record<string, string>[]).map(r => ({ ref: { type: t, id: r.id }, title: r[titleCol(t)] })) }))
  return res.flat().filter(x => !(x.ref.type === exclude.type && x.ref.id === exclude.id))
}
export const addRelation = (from: Parent, to: Parent, label: string) => supabase.from('relations').insert({ from_type: from.type, from_id: from.id, to_type: to.type, to_id: to.id, label: label.trim() || 'related to' })
export const removeRelation = (id: string) => supabase.from('relations').delete().eq('id', id)
