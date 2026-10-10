import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useRows } from '../hooks/useRows'
import { STEPS, type Step } from '../lib/guide'
import { daysUntil } from '../utils/dates'
import { Err } from '../components/ui'
export default function Guide() {
  const pr = useRows<{ id: string; step_key: string }>('guide_progress'), ev = useRows<{ id: string }>('events'), tk = useRows<{ id: string }>('tasks'), dr = useRows<{ id: string }>('daily_records'), dc = useRows<{ id: string }>('decisions')
  const [open, setOpen] = useState<string | null>(null)
  const auto = { events: ev.rows.length > 0, tasks: tk.rows.length >= 3, daily: dr.rows.length >= 1, decisions: dc.rows.length >= 1 }
  const row = (s: Step) => pr.rows.find(r => r.step_key === s.key)
  const done = (s: Step) => (s.auto ? auto[s.auto] : false) || !!row(s)
  const next = STEPS.find(s => !done(s)); const n = STEPS.filter(done).length
  const mark = (s: Step) => { const r = row(s); return r ? pr.remove(r.id, false) : pr.add({ step_key: s.key }) }
  const when = (s: Step) => { if (!s.due) return null; const d = daysUntil(s.due); return d < 0 ? `${-d} day(s) overdue — do this first` : d === 0 ? 'due today' : `due in ${d} day(s)` }
  return <div><Err msg={pr.error} />
    <p className="text-slate-400">You do not need to know anything yet. Do one step at a time.</p>
    <div className="bar my-3" role="progressbar" aria-valuenow={n} aria-valuemax={STEPS.length}><i style={{ width: `${(n / STEPS.length) * 100}%` }} /></div>
    <p className="mb-6 font-medium">{n} of {STEPS.length} steps done</p>
    {next ? <section className="card pop mb-8" style={{ borderColor: 'var(--accent)', borderWidth: 2 }}>
      <div className="text-sm uppercase tracking-wide text-slate-400">Your next step</div><h1 className="text-2xl font-bold my-1">{next.title}</h1>
      {when(next) && <p className="font-semibold">{when(next)}</p>}<p className="text-slate-400 mb-3">{next.why}</p>
      <ol className="list-decimal ml-6 mb-4 space-y-1">{next.todo.map(t => <li key={t}>{t}</li>)}</ol>
      <div className="flex flex-wrap gap-3">{next.to && <Link to={next.to} className="btn big">{next.cta}</Link>}{!next.auto && <button className="btn big ghost" onClick={() => mark(next)}>I did this ✓</button>}</div></section>
      : <section className="card pop mb-8"><h1 className="text-2xl font-bold">All starter steps done 🎉</h1><p>Keep your rhythm: Start Day → work → End Day. Check Timeline every Friday.</p></section>}
    <h2 className="font-semibold mb-2">All steps</h2>
    <ul className="space-y-2">{STEPS.map((s, i) => <li key={s.key} className="card">
      <button className="w-full text-left flex gap-3 items-center" onClick={() => setOpen(open === s.key ? null : s.key)} aria-expanded={open === s.key}>
        <span aria-hidden>{done(s) ? '✅' : s === next ? '👉' : '⚪'}</span><span className={'flex-1 ' + (done(s) ? 'line-through text-slate-400' : '')}>{i + 1}. {s.title}</span><span className="text-sm text-slate-400">{!done(s) && when(s)}</span></button>
      {open === s.key && <div className="mt-3 pop"><p className="text-slate-400">{s.why}</p><ul className="list-disc ml-6 my-2">{s.todo.map(t => <li key={t}>{t}</li>)}</ul>
        <div className="flex gap-2">{s.to && <Link to={s.to} className="btn ghost">{s.cta}</Link>}{!s.auto && <button className="btn ghost" onClick={() => mark(s)}>{done(s) ? 'Undo' : 'Mark done'}</button>}</div></div>}</li>)}</ul></div>
}
