import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { motion } from 'framer-motion'
import list from '../data/projects.json'
import { useRows } from '../hooks/useRows'
import { Err, Title, stagger } from '../components/ui'
const P = list as { id: string; title: string; year: string }[]
export default function Projects() {
  const [sp] = useSearchParams(); const [q, setQ] = useState(sp.get('q') ?? ''); const [tab, setTab] = useState<'all' | 'short'>('all')
  const { rows, error, add, remove } = useRows<{ id: string; step_key: string }>('guide_progress')
  const saved = new Map(rows.filter(r => r.step_key.startsWith('proj:')).map(r => [r.step_key.slice(5), r.id]))
  const shown = P.filter(p => (tab === 'all' || saved.has(p.id)) && p.title.toLowerCase().includes(q.toLowerCase()))
  return <div><Title sub={`${P.length} past project titles. These are inspiration, not specifications.`}>Project library</Title><Err msg={error} />
    <section className="card mb-5"><h2 className="font-bold mb-1">How to use this list</h2><ol className="list-decimal ml-6"><li>Find an idea that interests you and that you could explain in one sentence.</li><li>Make it <b>your take</b>: your own analysis and solution (handbook p.16). Copying is not allowed.</li><li>Ask: what problem does it solve, how would I <b>evaluate</b> it, what is the research angle?</li><li>Shortlist 2–3, then discuss at your first supervisor meeting.</li></ol></section>
    <input className="input mb-3" placeholder="Search titles…" value={q} onChange={e => setQ(e.target.value)} aria-label="Search projects" />
    <div className="flex gap-2 mb-4"><button className="pill" aria-pressed={tab === 'all'} onClick={() => setTab('all')}>All ({P.length})</button><button className="pill" aria-pressed={tab === 'short'} onClick={() => setTab('short')}>⭐ Shortlist ({saved.size})</button></div>
    <ul className="space-y-2">{shown.map((p, i) => { const id = saved.get(p.id); return <motion.li key={p.id} {...stagger(i)} className="card lift flex gap-3 items-center"><span className="flex-1">{p.title}<div className="text-sm text-slate-400">{p.year} · {p.id}</div></span>
      <button className="pill" aria-pressed={!!id} aria-label="Toggle shortlist" onClick={() => id ? remove(id, false) : add({ step_key: 'proj:' + p.id })}>{id ? '⭐ Saved' : '☆ Save'}</button></motion.li> })}</ul>
    {!shown.length && <p className="card">Nothing matches.</p>}</div>
}
