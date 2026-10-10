import { motion } from 'framer-motion'
import { useRows } from '../hooks/useRows'
import { CHECK } from '../data/checklist'
import { Bar, Err, Title, stagger } from '../components/ui'
import { daysUntil, fmt } from '../utils/dates'
export default function Checklist() {
  const { rows, error, add, remove } = useRows<{ id: string; step_key: string }>('guide_progress')
  const keys = new Map(rows.map(r => [r.step_key, r.id])); const k = (g: string, i: number) => `chk:${g}:${i}`
  const total = CHECK.reduce((a, g) => a + g.items.length, 0), done = CHECK.reduce((a, g) => a + g.items.filter((_, i) => keys.has(k(g.id, i))).length, 0)
  const toggle = (g: string, i: number) => { const id = keys.get(k(g, i)); return id ? remove(id, false) : add({ step_key: k(g, i) }) }
  return <div><Title sub="Everything the handbook requires, in order. Tick as you go — it is saved.">Master checklist</Title><Err msg={error} />
    <div className="card mb-6"><div className="flex justify-between mb-2"><b>Overall</b><b>{done}/{total} · {Math.round(done / total * 100)}%</b></div><Bar pct={done / total * 100} /></div>
    {CHECK.map(g => { const gd = g.items.filter((_, i) => keys.has(k(g.id, i))).length; return <section key={g.id} className="card mb-5">
      <div className="flex flex-wrap justify-between gap-2 mb-1"><h2 className="text-xl font-bold">{g.title}</h2><span className="text-slate-400">{gd}/{g.items.length}{g.due && ` · due ${fmt(g.due)} (${daysUntil(g.due) < 0 ? 'passed' : daysUntil(g.due) + ' days'})`}</span></div><Bar pct={gd / g.items.length * 100} />
      <ul className="mt-3 space-y-1">{g.items.map((t, i) => { const on = keys.has(k(g.id, i)); return <motion.li key={t} {...stagger(i)}><label className="flex gap-3 items-start py-1.5 cursor-pointer">
        <input type="checkbox" className="mt-1.5 h-5 w-5" style={{ accentColor: 'var(--accent)' }} checked={on} onChange={() => toggle(g.id, i)} /><motion.span animate={{ opacity: on ? .5 : 1 }} className={on ? 'line-through' : ''}>{t}</motion.span></label></motion.li> })}</ul></section> })}</div>
}
