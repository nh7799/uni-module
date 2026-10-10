import { useEffect, useState } from 'react'
import { useRows } from '../hooks/useRows'
import { todayISO, daysUntil } from '../utils/dates'
import { Err, Title } from '../components/ui'
import type { Daily, EventRow, Blocker, Task } from '../types'
type K = keyof Daily
const START: [K, string, string][] = [['mission', 'What is today’s mission?', 'One sentence. Example: “Get the login page working.”'], ['objective', 'What would make today a success?', 'Example: “I can sign in and see my dashboard.”']]
const END: [K, string, string][] = [['biggest_win', 'What was your biggest win today?', 'Anything counts, however small.'], ['biggest_challenge', 'What was hardest?', 'Naming it makes it smaller.'], ['learned', 'What did you learn?', 'This becomes material for your report.'], ['first_task_tomorrow', 'What is the very first task tomorrow?', 'So tomorrow starts with no thinking.']]
export default function Today() {
  const d = useRows<Daily>('daily_records', 'day'), ev = useRows<EventRow>('events', 'date', true), bl = useRows<Blocker>('blockers'), tk = useRows<Task>('tasks')
  const day = todayISO(); const rec = d.rows.find(r => r.day === day)
  const [mode, setMode] = useState<'start' | 'end'>('start'); const [i, setI] = useState(0); const [f, setF] = useState<Record<string, string>>({}); const [fin, setFin] = useState(false)
  useEffect(() => { setF(Object.fromEntries([...START, ...END].map(([k]) => [k, (rec?.[k] as string) ?? '']))) }, [rec?.id, d.loading])
  const qs = mode === 'start' ? START : END; const [k, q, hint] = qs[i]
  const next = ev.rows.filter(e => !e.done && daysUntil(e.date) >= 0)[0]
  const openB = bl.rows.filter(b => b.status === 'open'), core = tk.rows.filter(t => t.tier === 'core' && t.status === 'todo').length, str = tk.rows.filter(t => t.tier === 'stretch' && t.status === 'todo').length
  const overdue = ev.rows.filter(e => !e.done && daysUntil(e.date) < 0).length
  const health = overdue || openB.some(b => b.severity === 'high') ? 'AT RISK' : openB.length || (str && core) ? 'NEEDS ATTENTION' : 'ON TRACK'
  const why = [overdue && `${overdue} overdue event(s)`, openB.length && `${openB.length} open blocker(s)`, str && core && `${str} stretch task(s) open while ${core} core remain`].filter(Boolean).join('; ') || 'Nothing overdue, no blockers, scope is under control.'
  const save = async (completed: boolean) => { const v = { ...f, completed: completed || (rec?.completed ?? false) }; if (rec) await d.update(rec.id, v); else await d.add({ ...v, day }) }
  const go = async () => { const last = i === qs.length - 1; await save(last && mode === 'end'); if (!last) setI(i + 1); else if (mode === 'end') setFin(true); else setI(0) }
  return <div><Title sub={day}>Today</Title><Err msg={d.error || ev.error || bl.error || tk.error} />
    <section className="card mb-6"><div className="text-sm uppercase tracking-wide text-slate-400">Project health</div><div className="text-xl font-bold">{health}</div><p className="text-slate-400">Why: {why}</p>
      <p className="mt-2">{next ? <>Next deadline: <b>{next.title}</b> — {daysUntil(next.date)} day(s)</> : 'No upcoming deadlines yet. Load them on Timeline.'}</p></section>
    <div className="flex gap-2 mb-4">{(['start', 'end'] as const).map(m => <button key={m} className="pill" aria-pressed={mode === m} onClick={() => { setMode(m); setI(0); setFin(false) }}>{m === 'start' ? '☀️ Start my day' : '🌙 End my day'}</button>)}</div>
    {fin ? <section className="card pop"><h2 className="text-xl font-bold">Day complete ✓</h2><p>Well done. Tomorrow’s first task: <b>{f.first_task_tomorrow || 'not set'}</b></p></section>
      : <section className="card pop" key={mode + i}><div className="text-sm text-slate-400 mb-1">Question {i + 1} of {qs.length}</div><h2 className="text-xl font-bold">{q}</h2><p className="text-slate-400 mb-3">{hint}</p>
        <textarea autoFocus rows={4} className="input" value={f[k] ?? ''} onChange={e => setF({ ...f, [k]: e.target.value })} onKeyDown={e => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') go() }} />
        <div className="flex gap-3 mt-4"><button className="btn ghost" disabled={i === 0} onClick={() => setI(i - 1)}>Back</button><button className="btn big" onClick={go}>{i === qs.length - 1 ? (mode === 'end' ? 'Finish day' : 'Save') : 'Next'}</button></div>
        <p className="text-sm text-slate-400 mt-2">Tip: Ctrl+Enter continues. Everything is saved as you go.</p></section>}</div>
}
