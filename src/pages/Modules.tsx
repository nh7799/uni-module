import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { Err, Title } from '../components/ui'
import { AWARDS, creditSummary, forAward, semesterLabel, standing, type Award, type CatalogueModule } from '../lib/modules'
import catalogue from '../data/programme.json'
const CAT = catalogue as unknown as CatalogueModule[]
export interface ModRec { id: string; title: string; meta: { code?: string; credits?: number; level?: number; semester?: string; status?: string; target?: number; test?: number; exam?: number; coursework?: number; practical?: number; compulsory?: boolean }; archived_at: string | null }
interface Ass { id: string; module_id: string; title: string; occurred_on: string | null; meta: { weight?: number; mark?: number | null; due?: string } }
const today = () => new Date().toISOString().slice(0, 10)
export const STATUS: [string, string][] = [['planned', 'Planned'], ['in_progress', 'In progress'], ['completed', 'Completed']]

export default function Modules() {
  const [mods, setMods] = useState<ModRec[]>([]); const [ass, setAss] = useState<Ass[]>([]); const [err, setErr] = useState<string | null>(null); const [loading, setLoading] = useState(true); const [adding, setAdding] = useState(false)
  const load = useCallback(async () => {
    const [m, a] = await Promise.all([supabase.from('records').select('id,title,meta,archived_at').eq('kind', 'module').is('archived_at', null).order('title'), supabase.from('records').select('id,module_id,title,occurred_on,meta').eq('kind', 'assessment').is('archived_at', null)])
    setErr(m.error?.message ?? a.error?.message ?? null); setMods((m.data ?? []) as ModRec[]); setAss((a.data ?? []) as Ass[]); setLoading(false)
  }, [])
  useEffect(() => { load() }, [load])
  const rows = useMemo(() => mods.map(m => { const mine = ass.filter(a => a.module_id === m.id); const s = standing(mine.map(a => ({ weight: a.meta.weight ?? null, mark: a.meta.mark ?? null })), m.meta.target ?? 40)
    const next = mine.map(a => a.meta.due ?? a.occurred_on).filter((d): d is string => !!d && d >= today() && !mine.find(x => (x.meta.due ?? x.occurred_on) === d && x.meta.mark != null)).sort()[0] ?? null
    return { m, s, next, n: mine.length } }), [mods, ass])
  const credits = creditSummary(rows.map(r => ({ level: r.m.meta.level ?? 0, credits: r.m.meta.credits ?? 0, status: r.m.meta.status ?? '', passed: r.s.passed })))
  const groups = useMemo(() => { const g = new Map<number, typeof rows>(); for (const r of [...rows].sort((a, b) => (a.m.meta.code ?? '').localeCompare(b.m.meta.code ?? ''))) { const l = r.m.meta.level ?? 0; g.set(l, [...(g.get(l) ?? []), r]) } return [...g.entries()].sort((a, b) => a[0] - b[0]) }, [rows])
  const upcoming = rows.filter(r => r.next).sort((a, b) => a.next!.localeCompare(b.next!)).slice(0, 5)
  return <div><Title sub="Your modules, assessments, marks and notes in one place. Programme data comes from the BSc Computer Science / IT specification (Sept 2022).">My modules</Title><Err msg={err} />
    <div className="flex gap-2 mb-4 flex-wrap"><button className="btn" onClick={() => setAdding(!adding)}>{adding ? 'Close' : '＋ Add modules'}</button><Link className="pill" to="/library">All notes & records</Link></div>
    {adding && <Catalogue existing={new Set(mods.map(m => m.meta.code))} onDone={async () => { setAdding(false); await load() }} setErr={setErr} />}
    {loading ? <p>Loading…</p> : !mods.length && !adding ? <div className="card"><p className="font-bold">No modules yet.</p><p className="text-slate-400">Press “Add modules”, choose your award and level, and the compulsory modules are ticked for you.</p></div> : <>
      {upcoming.length > 0 && <section className="card mb-6"><h2 className="font-bold mb-2">Next deadlines</h2><ul>{upcoming.map(r => <li key={r.m.id} className="py-1"><Link className="underline" to={`/modules/${r.m.id}`}>{r.m.title}</Link> <span className="text-slate-400">· {r.next}</span></li>)}</ul></section>}
      {Object.keys(credits).length > 0 && <p className="text-sm text-slate-400 mb-4">Credits (planned / passed): {Object.entries(credits).map(([l, c]) => `Level ${l}: ${c.planned} / ${c.passed}`).join(' · ')}. “Passed” means 100% of a module marked at 40% or above.</p>}
      {groups.map(([level, list]) => <section key={level} className="mb-6"><h2 className="font-bold mb-2">Level {level || '?'}</h2><div className="grid gap-3 sm:grid-cols-2">{list.map(({ m, s, next, n }) => <Link key={m.id} to={`/modules/${m.id}`} className="card lift block">
        <div className="text-sm text-slate-400">{m.meta.code} · {m.meta.credits ?? '?'} credits · {m.meta.semester ? semesterLabel(m.meta.semester) : ''}</div><div className="font-bold">{m.title}</div>
        <div className="text-sm mt-1">{s.final !== null ? <>Final mark <b>{s.final}%</b> {s.passed ? '✓ pass' : '✗ below 40%'}</> : s.averageSoFar !== null ? <>Average so far <b>{s.averageSoFar}%</b> ({s.markedWeight}% marked)</> : n ? 'No marks yet' : 'No assessments added'}</div>
        <div className="text-xs text-slate-400">{STATUS.find(x => x[0] === m.meta.status)?.[1] ?? 'Planned'}{next ? ` · next due ${next}` : ''}</div></Link>)}</div></section>)}</>}</div>
}

function Catalogue({ existing, onDone, setErr }: { existing: Set<string | undefined>; onDone: () => Promise<void>; setErr: (s: string | null) => void }) {
  const [award, setAward] = useState<Award>('CS'); const [level, setLevel] = useState(4); const [variants, setVariants] = useState(false); const [pick, setPick] = useState<Set<string>>(new Set()); const [busy, setBusy] = useState(false)
  const list = useMemo(() => forAward(CAT, award, level, variants), [award, level, variants])
  useEffect(() => { setPick(new Set(list.filter(m => m.awards[award] === 'compulsory' && !existing.has(m.code) && !m.passfail).map(m => m.code))) }, [list, award])
  const total = list.filter(m => pick.has(m.code)).reduce((a, m) => a + m.credits, 0)
  const add = async () => {
    setBusy(true); const chosen = list.filter(m => pick.has(m.code) && !existing.has(m.code))
    const { error } = await supabase.from('records').insert(chosen.map(m => ({ kind: 'module', title: m.title, tags: [], meta: { code: m.code, credits: m.credits, level: m.level, semester: m.semester, status: 'planned', target: 40, test: m.test, exam: m.exam, coursework: m.coursework, practical: m.practical, compulsory: m.awards[award] === 'compulsory', award } })))
    setBusy(false); if (error) return setErr(error.message); setErr(null); await onDone()
  }
  return <section className="card mb-6 pop"><div className="grid gap-3 sm:grid-cols-2 mb-3">
    <label className="text-sm text-slate-400 font-medium">Award<select className="input" value={award} onChange={e => setAward(e.target.value as Award)}>{AWARDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
    <label className="text-sm text-slate-400 font-medium">Level (year)<select className="input" value={level} onChange={e => setLevel(Number(e.target.value))}>{[[4, 'Level 4 (year 1)'], [5, 'Level 5 (year 2)'], [6, 'Level 6 (final year)']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label></div>
    <ul className="space-y-1">{list.map(m => <li key={m.code}><label className={existing.has(m.code) ? 'opacity-50' : ''}><input type="checkbox" disabled={existing.has(m.code)} checked={pick.has(m.code) || existing.has(m.code)} onChange={e => { const n = new Set(pick); e.target.checked ? n.add(m.code) : n.delete(m.code); setPick(n) }} /> <b>{m.code}</b> {m.title} <span className="text-slate-400 text-sm">· {m.credits} cr · {m.semester} · {m.awards[award]}{existing.has(m.code) ? ' · already added' : ''}</span></label></li>)}</ul>
    <label className="text-sm text-slate-400 block mt-3"><input type="checkbox" checked={variants} onChange={e => setVariants(e.target.checked)} /> Show International College (HIC) and online (COM) variants</label>
    <p className="text-sm mt-2">{pick.size} selected · {total} credits. At level 6 you choose optional modules to reach 120 credits. Check the list against your Canvas module page; the specification can change.</p>
    <button className="btn mt-2" disabled={busy || !pick.size} onClick={add}>{busy ? 'Adding…' : `Add ${pick.size} module(s)`}</button></section>
}
