import { motion } from 'framer-motion'
import { Link } from 'react-router-dom'
import { useRows } from '../hooks/useRows'
import { DATES } from '../data/handbook'
import { CHECK } from '../data/checklist'
import { addDays, daysUntil, fmt, todayISO } from '../utils/dates'
import { Bar } from '../components/ui'
import Guide from './Guide'
export default function Home() {
  const dr = useRows<{ id: string; day: string; completed: boolean }>('daily_records', 'day'), pr = useRows<{ id: string; step_key: string }>('guide_progress')
  const next = DATES.find(d => d.k === 'official' && daysUntil(d.d) >= 0); const days = new Set(dr.rows.map(r => r.day)); const t = todayISO()
  let streak = 0; for (let i = days.has(t) ? 0 : 1; days.has(addDays(t, -i)); i++) streak++
  const total = CHECK.reduce((a, g) => a + g.items.length, 0), done = pr.rows.filter(r => r.step_key.startsWith('chk:')).length
  const week = Array.from({ length: 7 }, (_, i) => addDays(t, i - 6))
  const stat = (l: string, v: string, s?: string) => <div className="card lift"><div className="text-sm text-slate-400">{l}</div><div className="text-2xl font-bold">{v}</div>{s && <div className="text-sm text-slate-400">{s}</div>}</div>
  return <div><motion.section initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="hero mb-6"><div className="text-sm opacity-90">{fmt(t)}</div>
      <h1 className="text-3xl font-bold">{next ? `${daysUntil(next.d)} days to your next official deadline` : 'No upcoming official deadlines'}</h1>{next && <p className="opacity-90">{next.t} · {fmt(next.d)}</p>}
      <p className="mt-2 opacity-90">Report due in <b>{Math.max(0, daysUntil('2027-04-09'))} days</b> (Fri 9 Apr 2027, 15:00)</p></motion.section>
    <div className="grid gap-3 sm:grid-cols-3 mb-6">{stat('Day streak', `${streak} 🔥`, 'Consecutive days with a daily record')}{stat('Checklist', `${Math.round(done / total * 100)}%`, `${done} of ${total} items`)}{stat('Handbook', 'Open →', 'Rules, grading, dates')}</div>
    <div className="card mb-6"><div className="flex justify-between mb-2"><b>Last 7 days</b><Link to="/today" className="text-sky-400 font-semibold">Log today →</Link></div>
      <div className="grid grid-cols-7 gap-2">{week.map(d => <motion.div key={d} initial={{ scale: .8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="text-center rounded-xl py-2" style={{ background: days.has(d) ? 'var(--accent)' : 'var(--surface2)', color: days.has(d) ? 'var(--on-accent)' : 'var(--muted)' }}><div className="text-xs">{new Date(d + 'T00:00:00Z').toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' })}</div><div className="font-bold">{d.slice(8)}</div></motion.div>)}</div>
      <div className="mt-3"><Bar pct={done / total * 100} /></div></div>
    <Guide /></div>
}
