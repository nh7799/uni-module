import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { motion } from 'framer-motion'
import { DATES, SECS, WEIGHTS } from '../data/handbook'
import { daysUntil, fmt } from '../utils/dates'
import { Title, stagger } from '../components/ui'
export default function Handbook() {
  const [sp] = useSearchParams(); const [q, setQ] = useState(sp.get('q') ?? ''); const [sec, setSec] = useState(sp.get('sec') ?? 'all'); const [open, setOpen] = useState<string | null>(null)
  const ql = q.toLowerCase()
  const secs = useMemo(() => SECS.map(s => ({ ...s, items: s.items.filter(i => !ql || (i.t + i.d).toLowerCase().includes(ql)) })).filter(s => s.items.length && (sec === 'all' || sec === 'dates' ? sec === 'all' : s.id === sec)), [ql, sec])
  const dates = DATES.filter(d => !ql || d.t.toLowerCase().includes(ql))
  return <div><Title sub="Everything from the BSc Computer Science Project Handbook (v0.9, 27 Jul 2026), condensed. Page numbers point to the PDF. Confirm dates on Canvas.">Handbook</Title>
    <input className="input mb-3" placeholder="Search the handbook… (e.g. viva, Turnitin, logbook)" value={q} onChange={e => setQ(e.target.value)} aria-label="Search handbook" />
    <div className="sticky-tabs flex gap-2 overflow-x-auto">{[['all', '📚', 'All'], ['dates', '📅', 'Dates'], ...SECS.map(s => [s.id, s.icon, s.title])].map(([id, ic, l]) => <button key={id} className="pill whitespace-nowrap" aria-pressed={sec === id} onClick={() => setSec(id)}>{ic} {l}</button>)}</div>
    {(sec === 'all' || sec === 'dates') && dates.length > 0 && <section className="card my-4"><h2 className="text-xl font-bold mb-3">📅 Key dates</h2><ul className="divide-y divide-slate-800">{dates.map((d, i) => { const n = daysUntil(d.d); return <motion.li key={d.d + d.t} {...stagger(i)} className="py-2 flex gap-3 items-start">
      <span className="w-28 shrink-0 font-semibold">{fmt(d.d)}</span><span className="flex-1">{d.t} <span className={'chip ' + (d.k === 'official' ? 'acc' : '')}>{d.k === 'official' ? 'OFFICIAL' : 'INFO'}</span> <span className="chip">p.{d.p}</span></span>
      <span className="text-slate-400 whitespace-nowrap">{n < 0 ? 'passed' : n === 0 ? 'today' : `${n}d`}</span></motion.li> })}</ul></section>}
    {(sec === 'all' || sec === 'assessment') && !ql && <section className="card my-4"><h2 className="text-xl font-bold mb-3">Where the marks are</h2>{WEIGHTS.map(([n, w, who]) => <div key={n} className="mb-3"><div className="flex justify-between"><span>{n}</span><b>{w}%</b></div><div className="bar"><motion.i initial={{ width: 0 }} animate={{ width: `${w}%` }} transition={{ duration: .7 }} /></div><div className="text-sm text-slate-400">Marked by: {who}</div></div>)}</section>}
    {sec !== 'dates' && secs.map(s => <section key={s.id} className="my-6"><h2 className="text-xl font-bold mb-3">{s.icon} {s.title}</h2>
      <div className="space-y-2">{s.items.map((i, k) => { const key = s.id + i.t; return <motion.div key={key} {...stagger(k)} className="card lift"><button className="w-full text-left flex gap-3 items-center" aria-expanded={open === key} onClick={() => setOpen(open === key ? null : key)}>
        <span className="flex-1 font-semibold">{i.t}</span>{i.p && <span className="chip">p.{i.p}</span>}<span aria-hidden>{open === key || ql ? '−' : '+'}</span></button>
        {(open === key || ql) && <motion.p initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} className="mt-2 text-slate-400">{i.d}</motion.p>}</motion.div> })}</div></section>)}
    {!secs.length && sec !== 'dates' && <p className="card">No handbook entries match “{q}”.</p>}</div>
}
