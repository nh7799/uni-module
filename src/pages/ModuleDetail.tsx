import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { Err } from '../components/ui'
import Attachments from '../components/Attachments'
import Related from '../components/Related'
import RecordExtras from '../components/RecordExtras'
import { num, semesterLabel, specComponents, standing, validMark } from '../lib/modules'
import { STATUS, type ModRec } from './Modules'
import { KINDS } from './Library'
interface Child { id: string; kind: string; title: string; occurred_on: string | null; meta: { weight?: number; mark?: number | null; due?: string }; tags: string[] }
const KL = Object.fromEntries(KINDS)
const CHILD_KINDS = ['lecture', 'note', 'resource', 'programming_note', 'revision_card', 'timetable', 'meeting', 'experiment']
export default function ModuleDetail() {
  const { id = '' } = useParams(); const nav = useNavigate(); const [m, setM] = useState<ModRec | null>(null); const [kids, setKids] = useState<Child[]>([]); const [err, setErr] = useState<string | null>(null); const [loading, setLoading] = useState(true)
  const load = useCallback(async () => {
    const [a, b] = await Promise.all([supabase.from('records').select('id,title,meta,archived_at').eq('id', id).eq('kind', 'module').maybeSingle(), supabase.from('records').select('id,kind,title,occurred_on,meta,tags').eq('module_id', id).is('archived_at', null).order('occurred_on', { ascending: false, nullsFirst: false }).order('updated_at', { ascending: false })])
    setErr(a.error?.message ?? b.error?.message ?? null); setM(a.data as ModRec | null); setKids((b.data ?? []) as Child[]); setLoading(false)
  }, [id])
  useEffect(() => { load() }, [load])
  const ass = kids.filter(k => k.kind === 'assessment'); const others = kids.filter(k => k.kind !== 'assessment')
  const s = useMemo(() => standing(ass.map(a => ({ weight: a.meta.weight ?? null, mark: a.meta.mark ?? null })), m?.meta.target ?? 40), [ass, m])
  if (loading) return <p>Loading…</p>
  if (!m) return <div><p className="danger">This module was not found (it may be archived or deleted).</p><Link className="underline" to="/modules">← Back to modules</Link></div>
  const saveMeta = async (patch: Record<string, unknown>) => { const { error } = await supabase.from('records').update({ meta: { ...m.meta, ...patch } }).eq('id', m.id); setErr(error?.message ?? null); await load() }
  const fromSpec = async () => {
    const comps = specComponents({ test: m.meta.test ?? 0, exam: m.meta.exam ?? 0, coursework: m.meta.coursework ?? 0, practical: m.meta.practical ?? 0 }).filter(c => !ass.some(a => a.title === c.title))
    if (!comps.length) return setErr('The programme specification components are already added (or none are listed for this module).')
    const { error } = await supabase.from('records').insert(comps.map(c => ({ kind: 'assessment', title: c.title, module_id: m.id, meta: { weight: c.weight } }))); setErr(error?.message ?? null); await load()
  }
  const archive = async () => { if (!confirm(`Archive "${m.title}"? It disappears from this list but nothing is deleted and you can restore it from the Library.`)) return; const { error } = await supabase.from('records').update({ archived_at: new Date().toISOString() }).eq('id', m.id); if (error) return setErr(error.message); nav('/modules') }
  const grouped = CHILD_KINDS.map(k => [k, others.filter(o => o.kind === k)] as const).filter(([, l]) => l.length)
  const msg = s.final !== null ? `Final mark ${s.final}% — ${s.passed ? 'pass' : 'below the 40% pass mark'}.` : s.neededAverage === null ? 'Add assessments with weights to see your standing.' : s.achievable ? `You need an average of ${Math.max(0, s.neededAverage)}% on the remaining ${s.remainingWeight}% to reach your ${m.meta.target ?? 40}% target.` : `Your ${m.meta.target ?? 40}% target is no longer reachable (you would need ${s.neededAverage}% on the remaining ${s.remainingWeight}%).`
  return <div><Link className="text-sm underline" to="/modules">← All modules</Link>
    <header className="my-3"><div className="text-sm text-slate-400">{m.meta.code} · Level {m.meta.level ?? '?'} · {m.meta.credits ?? '?'} credits{m.meta.semester ? ' · ' + semesterLabel(m.meta.semester) : ''}{m.meta.compulsory === false ? ' · optional' : ''}</div><h1 className="text-2xl font-bold">{m.title}</h1></header><Err msg={err} />
    <section className="card mb-6 grid gap-3 sm:grid-cols-3">
      <label className="text-sm text-slate-400 font-medium">Status<select className="input" value={m.meta.status ?? 'planned'} onChange={e => saveMeta({ status: e.target.value })}>{STATUS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
      <label className="text-sm text-slate-400 font-medium">Target mark (%)<input className="input" type="number" min={0} max={100} defaultValue={m.meta.target ?? 40} onBlur={e => { const n = num(e.target.value); if (n === null || !validMark(n)) return setErr('The target must be between 0 and 100.'); saveMeta({ target: n }) }} /></label>
      <div className="text-sm"><div className="text-slate-400 font-medium">Standing</div><div className="font-bold text-xl">{s.final ?? s.averageSoFar ?? '—'}{s.final ?? s.averageSoFar ? '%' : ''}</div><div className="text-slate-400">{s.final !== null ? 'final' : 'average of marked work'}</div></div>
      <p className="sm:col-span-3" role="status">{msg}</p></section>
    <section className="mb-6"><div className="flex items-center gap-2 mb-2"><h2 className="font-bold">Assessments</h2><button className="pill ml-auto" onClick={fromSpec}>Add components from programme spec</button></div>
      {s.assignedWeight > 100 && <p className="warn mb-2">Weights add up to {s.assignedWeight}%, which is over 100%. Marks are still calculated as entered; check the weights.</p>}
      {s.unassigned > 0 && ass.length > 0 && <p className="text-sm text-slate-400 mb-2">{s.unassigned}% of the module has no assessment yet.</p>}
      <ul className="space-y-2">{ass.map(a => <AssRow key={a.id} a={a} onSaved={load} setErr={setErr} />)}{!ass.length && <li className="card">No assessments yet. Use “Add components from programme spec” or add your own below.</li>}</ul><AddAss moduleId={m.id} onAdded={load} setErr={setErr} /></section>
    <section className="mb-6"><h2 className="font-bold mb-2">Notes, lectures and resources</h2><QuickAdd moduleId={m.id} onAdded={load} setErr={setErr} />
      {grouped.map(([k, l]) => <div key={k} className="mb-3"><h3 className="text-sm text-slate-400 font-medium">{KL[k]} ({l.length})</h3><ul className="space-y-1">{l.map(r => <li key={r.id} className="card py-2"><Link className="font-semibold underline" to={`/library?open=${r.id}`}>{r.title}</Link> <span className="text-sm text-slate-400">{r.occurred_on ?? ''}{r.tags.length ? ' · #' + r.tags.join(' #') : ''}</span><RecordExtras parent={{ type: 'records', id: r.id }} title={r.title} /></li>)}</ul></div>)}
      {!others.length && <p className="text-slate-400">Nothing yet. Add your first lecture or note above.</p>}</section>
    <section className="mb-6"><h2 className="font-bold mb-2">📎 Module files</h2><Attachments parent={{ type: 'records', id: m.id }} /></section>
    <section className="mb-6"><h2 className="font-bold mb-2">🔗 Related</h2><Related parent={{ type: 'records', id: m.id }} selfTitle={m.title} /></section>
    <div className="flex gap-2"><Link className="pill" to={`/library?open=${m.id}`}>Edit all details</Link><button className="pill" onClick={archive}>🗄 Archive module</button></div></div>
}
function AssRow({ a, onSaved, setErr }: { a: Child; onSaved: () => Promise<void>; setErr: (s: string | null) => void }) {
  const [w, setW] = useState(a.meta.weight?.toString() ?? ''); const [mk, setMk] = useState(a.meta.mark?.toString() ?? ''); const [due, setDue] = useState(a.meta.due ?? a.occurred_on ?? '')
  const dirty = w !== (a.meta.weight?.toString() ?? '') || mk !== (a.meta.mark?.toString() ?? '') || due !== (a.meta.due ?? a.occurred_on ?? '')
  const save = async () => { const wn = num(w), mn = num(mk); if (wn !== null && (wn < 0 || wn > 100)) return setErr('Weight must be between 0 and 100.'); if (!validMark(mn)) return setErr('A mark must be between 0 and 100.')
    const { error } = await supabase.from('records').update({ occurred_on: due || null, meta: { ...a.meta, weight: wn ?? undefined, mark: mn, due: due || undefined } }).eq('id', a.id); setErr(error?.message ?? null); await onSaved() }
  const del = async () => { if (!confirm(`Delete assessment "${a.title}"? Its files and links are removed too. This cannot be undone.`)) return; const { error } = await supabase.from('records').delete().eq('id', a.id); setErr(error?.message ?? null); await onSaved() }
  return <li className="card"><div className="flex items-center gap-2 flex-wrap"><Link className="font-semibold underline flex-1" to={`/library?open=${a.id}`}>{a.title}</Link><button className="text-slate-500" onClick={del} aria-label={`Delete ${a.title}`}>✕</button></div>
    <div className="grid grid-cols-3 gap-2 mt-2"><label className="text-xs text-slate-400">Weight %<input className="input" type="number" min={0} max={100} value={w} onChange={e => setW(e.target.value)} /></label><label className="text-xs text-slate-400">Due<input className="input" type="date" value={due} onChange={e => setDue(e.target.value)} /></label><label className="text-xs text-slate-400">Mark %<input className="input" type="number" min={0} max={100} step="0.1" value={mk} onChange={e => setMk(e.target.value)} placeholder="not marked" /></label></div>
    <div className="flex items-center gap-3 mt-2"><button className="btn" disabled={!dirty} onClick={save}>Save</button><span className="text-xs text-slate-400">{dirty ? '● Unsaved' : '✓ Saved'}</span></div><RecordExtras parent={{ type: 'records', id: a.id }} title={a.title} /></li>
}
function AddAss({ moduleId, onAdded, setErr }: { moduleId: string; onAdded: () => Promise<void>; setErr: (s: string | null) => void }) {
  const [t, setT] = useState(''); const [w, setW] = useState('')
  return <form className="flex gap-2 mt-3" onSubmit={async e => { e.preventDefault(); const wn = num(w); if (wn !== null && (wn < 0 || wn > 100)) return setErr('Weight must be between 0 and 100.'); const { error } = await supabase.from('records').insert({ kind: 'assessment', title: t.trim(), module_id: moduleId, meta: wn !== null ? { weight: wn } : {} }); setErr(error?.message ?? null); if (!error) { setT(''); setW(''); await onAdded() } }}>
    <input className="input flex-1" required placeholder="New assessment (e.g. Coursework 1)" value={t} onChange={e => setT(e.target.value)} aria-label="Assessment name" /><input className="input w-24" type="number" min={0} max={100} placeholder="Weight %" value={w} onChange={e => setW(e.target.value)} aria-label="Weight percent" /><button className="btn">Add</button></form>
}
function QuickAdd({ moduleId, onAdded, setErr }: { moduleId: string; onAdded: () => Promise<void>; setErr: (s: string | null) => void }) {
  const [k, setK] = useState('lecture'); const [t, setT] = useState(''); const [d, setD] = useState('')
  return <form className="flex gap-2 flex-wrap mb-3" onSubmit={async e => { e.preventDefault(); const { error } = await supabase.from('records').insert({ kind: k, title: t.trim(), module_id: moduleId, occurred_on: d || null }); setErr(error?.message ?? null); if (!error) { setT(''); await onAdded() } }}>
    <select className="input w-auto" value={k} onChange={e => setK(e.target.value)} aria-label="Type">{CHILD_KINDS.map(x => <option key={x} value={x}>{KL[x]}</option>)}</select><input className="input flex-1 min-w-40" required placeholder="Title" value={t} onChange={e => setT(e.target.value)} aria-label="Title" /><input className="input w-auto" type="date" value={d} onChange={e => setD(e.target.value)} aria-label="Date" /><button className="btn">Add</button></form>
}
