import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { Err, Title } from '../components/ui'
import Attachments from '../components/Attachments'
import Related from '../components/Related'
export const KINDS: [string, string][] = [['module', 'Module'], ['timetable', 'Timetable entry'], ['lecture', 'Lecture'], ['note', 'Note'], ['resource', 'Module resource'], ['assessment', 'Assessment / assignment'], ['programming_note', 'Programming / debugging note'], ['fyp_research', 'Project research'], ['fyp_milestone', 'Project milestone'], ['experiment', 'Experiment record'], ['meeting', 'Meeting note'], ['revision_card', 'Revision card'], ['research_source', 'Research source'], ['knowledge', 'Knowledge entry']]
const KL = Object.fromEntries(KINDS)
export interface Rec { id: string; kind: string; title: string; body: string; meta: { code?: string; url?: string; due?: string }; occurred_on: string | null; module_id: string | null; tags: string[]; archived_at: string | null; updated_at: string }
const tagsOf = (s: string) => [...new Set(s.split(',').map(t => t.trim()).filter(Boolean))]
export default function Library() {
  const [sp, setSp] = useSearchParams(); const open = sp.get('open'); const [kind, setKind] = useState(''); const [mod, setMod] = useState(''); const [q, setQ] = useState(''); const [arch, setArch] = useState(false)
  const [rows, setRows] = useState<Rec[]>([]); const [modules, setModules] = useState<Rec[]>([]); const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(true)
  const load = useCallback(async () => {
    let s = supabase.from('records').select('*').order('updated_at', { ascending: false }).limit(300)
    if (kind) s = s.eq('kind', kind); if (mod) s = s.eq('module_id', mod); if (!arch) s = s.is('archived_at', null)
    const t = q.trim().replace(/[,()*%]/g, ' '); if (t) s = s.or(`title.ilike.%${t}%,fts.wfts(english).${t},tags.cs.{${t.replace(/\s+/g, '')}}`)
    const [r, m] = await Promise.all([s, supabase.from('records').select('*').eq('kind', 'module').is('archived_at', null).order('title')])
    setErr(r.error?.message ?? m.error?.message ?? null); setRows((r.data ?? []) as Rec[]); setModules((m.data ?? []) as Rec[]); setBusy(false)
  }, [kind, mod, q, arch])
  useEffect(() => { const t = setTimeout(load, q ? 250 : 0); return () => clearTimeout(t) }, [load])
  const [f, setF] = useState({ kind: 'note', title: '', module_id: '', occurred_on: '', tags: '', body: '' })
  const create = async (e: React.FormEvent) => { e.preventDefault(); const { data, error } = await supabase.from('records').insert({ kind: f.kind, title: f.title.trim(), body: f.body, module_id: f.kind === 'module' ? null : f.module_id || null, occurred_on: f.occurred_on || null, tags: tagsOf(f.tags) }).select('id').single(); if (error) return setErr(error.message); setErr(null); setF({ ...f, title: '', body: '', tags: '' }); await load(); setSp({ open: data.id }) }
  const current = rows.find(r => r.id === open)
  const [direct, setDirect] = useState<Rec | null>(null)
  useEffect(() => { if (open && !current) supabase.from('records').select('*').eq('id', open).maybeSingle().then(({ data }) => setDirect(data as Rec | null)); else setDirect(null) }, [open, current?.id])
  const sel = current ?? direct
  return <div><Title sub="Modules, lectures, notes, assessments, project work and more: all searchable, linkable and exportable.">Academic library</Title><Err msg={err} />
    <form className="card grid gap-3 sm:grid-cols-2 mb-6" onSubmit={create}>
      <label className="text-sm text-slate-400 font-medium">Type<select className="input" value={f.kind} onChange={e => setF({ ...f, kind: e.target.value })}>{KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
      <label className="text-sm text-slate-400 font-medium">Title<input className="input" required value={f.title} onChange={e => setF({ ...f, title: e.target.value })} /></label>
      <label className="text-sm text-slate-400 font-medium">Module<select className="input" disabled={f.kind === 'module'} value={f.module_id} onChange={e => setF({ ...f, module_id: e.target.value })}><option value="">(none)</option>{modules.map(m => <option key={m.id} value={m.id}>{m.title}</option>)}</select></label>
      <label className="text-sm text-slate-400 font-medium">Date<input type="date" className="input" value={f.occurred_on} onChange={e => setF({ ...f, occurred_on: e.target.value })} /></label>
      <label className="text-sm text-slate-400 font-medium sm:col-span-2">Tags (comma separated)<input className="input" value={f.tags} onChange={e => setF({ ...f, tags: e.target.value })} /></label>
      <label className="text-sm text-slate-400 font-medium sm:col-span-2">{f.kind === 'revision_card' ? 'Answer' : 'Notes'}<textarea className="input" rows={3} value={f.body} onChange={e => setF({ ...f, body: e.target.value })} /></label>
      <button className="btn sm:col-span-2">Create</button></form>
    <div className="grid gap-2 sm:grid-cols-4 mb-3"><input className="input sm:col-span-2" placeholder="Search titles, notes and tags…" value={q} onChange={e => setQ(e.target.value)} aria-label="Search library" />
      <select className="input" value={kind} onChange={e => setKind(e.target.value)} aria-label="Filter by type"><option value="">All types</option>{KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
      <select className="input" value={mod} onChange={e => setMod(e.target.value)} aria-label="Filter by module"><option value="">All modules</option>{modules.map(m => <option key={m.id} value={m.id}>{m.title}</option>)}</select></div>
    <label className="text-sm text-slate-400 block mb-3"><input type="checkbox" checked={arch} onChange={e => setArch(e.target.checked)} /> Show archived</label>
    {sel && <Detail key={sel.id} rec={sel} modules={modules} onClose={() => setSp({})} onChanged={load} setErr={setErr} />}
    {busy ? <p>Loading…</p> : <ul className="space-y-2">{rows.filter(r => r.id !== open).map(r => <li key={r.id}><button className="card lift w-full text-left" onClick={() => setSp({ open: r.id })} style={{ opacity: r.archived_at ? 0.6 : 1 }}>
      <b>{r.title}</b> {r.archived_at && <span className="text-xs">(archived)</span>}<div className="text-sm text-slate-400">{KL[r.kind]}{r.module_id ? ' · ' + (modules.find(m => m.id === r.module_id)?.title ?? 'module') : ''}{r.occurred_on ? ' · ' + r.occurred_on : ''}{r.tags.length ? ' · #' + r.tags.join(' #') : ''}</div></button></li>)}
      {!rows.length && <li className="card">Nothing here yet.</li>}</ul>}</div>
}
function Detail({ rec, modules, onClose, onChanged, setErr }: { rec: Rec; modules: Rec[]; onClose: () => void; onChanged: () => Promise<void>; setErr: (s: string | null) => void }) {
  const init = { title: rec.title, body: rec.body, occurred_on: rec.occurred_on ?? '', module_id: rec.module_id ?? '', tags: rec.tags.join(', '), code: rec.meta?.code ?? '', url: rec.meta?.url ?? '', due: rec.meta?.due ?? '' }
  const [d, setD] = useState(init); const [state, setState] = useState<'saved' | 'saving'>('saved'); const dirty = (Object.keys(init) as (keyof typeof init)[]).some(k => d[k] !== init[k])
  useEffect(() => { if (!dirty) return; const h = (e: BeforeUnloadEvent) => { e.preventDefault() }; window.addEventListener('beforeunload', h); return () => window.removeEventListener('beforeunload', h) }, [dirty])
  const save = async () => { if (!d.title.trim()) return setErr('The title cannot be empty.'); setState('saving'); const meta = { ...rec.meta, code: d.code || undefined, url: d.url || undefined, due: d.due || undefined }
    const { error } = await supabase.from('records').update({ title: d.title.trim(), body: d.body, occurred_on: d.occurred_on || null, module_id: rec.kind === 'module' ? null : d.module_id || null, tags: tagsOf(d.tags), meta }).eq('id', rec.id); setState('saved'); setErr(error?.message ?? null); await onChanged() }
  const archive = async () => { const { error } = await supabase.from('records').update({ archived_at: rec.archived_at ? null : new Date().toISOString() }).eq('id', rec.id); setErr(error?.message ?? null); await onChanged() }
  const del = async () => {
    const [a, r1, r2, kids] = await Promise.all([supabase.from('attachments').select('id', { count: 'exact', head: true }).eq('parent_type', 'records').eq('parent_id', rec.id).neq('status', 'pending_deletion'), supabase.from('relations').select('id', { count: 'exact', head: true }).eq('from_type', 'records').eq('from_id', rec.id), supabase.from('relations').select('id', { count: 'exact', head: true }).eq('to_type', 'records').eq('to_id', rec.id), supabase.from('records').select('id', { count: 'exact', head: true }).eq('module_id', rec.id)])
    if ((kids.count ?? 0) > 0) return setErr(`"${rec.title}" still contains ${kids.count} record(s). Move or archive them first; nothing was deleted.`)
    if (!confirm(`Delete "${rec.title}" permanently?\n\n• ${a.count ?? 0} attachment(s) will be queued for file deletion\n• ${(r1.count ?? 0) + (r2.count ?? 0)} relationship link(s) will be removed\n\nArchiving keeps everything and is reversible. This cannot be undone.`)) return
    const { error } = await supabase.from('records').delete().eq('id', rec.id); if (error) return setErr(error.code === '23503' ? 'Other records still depend on this one; nothing was deleted.' : error.message)
    setErr(null); onClose(); await onChanged()
  }
  const inp = (k: keyof typeof d, label: string, type = 'text') => <label className="text-sm text-slate-400 font-medium">{label}<input type={type} className="input" value={d[k]} onChange={e => setD({ ...d, [k]: e.target.value })} /></label>
  return <section className="card mb-6 pop" aria-label={`Editing ${rec.title}`}>
    <div className="flex items-center gap-2 mb-3"><span className="pill text-xs py-0">{KL[rec.kind]}</span>{rec.archived_at && <span className="pill text-xs py-0">archived</span>}<button className="ml-auto" onClick={onClose} aria-label="Close">✕</button></div>
    <div className="grid gap-3 sm:grid-cols-2">{inp('title', 'Title')}{inp('occurred_on', 'Date', 'date')}
      {rec.kind !== 'module' && <label className="text-sm text-slate-400 font-medium">Module<select className="input" value={d.module_id} onChange={e => setD({ ...d, module_id: e.target.value })}><option value="">(none)</option>{modules.map(m => <option key={m.id} value={m.id}>{m.title}</option>)}</select></label>}
      {inp('tags', 'Tags (comma separated)')}{inp('code', rec.kind === 'module' ? 'Module code' : 'Reference / code')}{inp('url', 'URL / citation')}{['assessment', 'fyp_milestone'].includes(rec.kind) && inp('due', 'Due date', 'date')}
      <label className="text-sm text-slate-400 font-medium sm:col-span-2">{rec.kind === 'revision_card' ? 'Answer' : 'Notes'}<textarea className="input" rows={8} value={d.body} onChange={e => setD({ ...d, body: e.target.value })} /></label></div>
    <div className="flex gap-3 items-center mt-3 flex-wrap"><button className="btn" disabled={!dirty || state === 'saving'} onClick={save}>Save</button><span className="text-sm text-slate-400" role="status">{state === 'saving' ? 'Saving…' : dirty ? '● Unsaved edits' : '✓ Saved to the database'}</span>
      <button className="pill ml-auto" onClick={archive}>{rec.archived_at ? '↩ Restore' : '🗄 Archive'}</button><button className="pill" onClick={del}>🗑 Delete…</button></div>
    <h3 className="font-bold mt-5">📎 Attachments</h3><Attachments parent={{ type: 'records', id: rec.id }} />
    <h3 className="font-bold mt-5">🔗 Related</h3><Related parent={{ type: 'records', id: rec.id }} selfTitle={rec.title} /></section>
}
