import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { parentLink } from '../pages/Health'
import { motion } from 'framer-motion'
import { SECS } from '../data/handbook'
import list from '../data/projects.json'
type R = { label: string; sub: string; to: string }
const PAGES: R[] = [['modules', 'My modules'], ['home', 'Home'], ['today', 'Today'], ['checklist', 'Checklist'], ['timeline', 'Timeline'], ['handbook', 'Handbook'], ['library', 'Academic library'], ['export', 'Export & recovery'], ['health', 'System health'], ['projects', 'Project library'], ['tasks', 'Tasks'], ['decisions', 'Decisions'], ['blockers', 'Blockers'], ['settings', 'Settings']].map(([p, l]) => ({ label: l, sub: 'Page', to: '/' + p }))
export default function Palette({ onClose }: { onClose: () => void }) {
  const [q, setQ] = useState(''); const nav = useNavigate()
  useEffect(() => { const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose(); window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h) }, [onClose])
  const [found, setFound] = useState<R[]>([])
  useEffect(() => { const t = q.trim(); if (t.length < 2) { setFound([]); return }
    const h = setTimeout(async () => { const { data } = await supabase.rpc('search_all', { q: t, lim: 10 }); setFound(((data ?? []) as { entity_type: string; entity_id: string; parent_type: string | null; parent_id: string | null; title: string; snippet: string | null }[]).map(x => ({ label: x.title, sub: (x.entity_type === 'attachments' ? 'Attachment text' : 'Library') + (x.snippet ? ' · ' + x.snippet : ''), to: x.entity_type === 'records' ? `/library?open=${x.entity_id}` : parentLink(x.parent_type ?? 'records', x.parent_id ?? '') }))) }, 250)
    return () => clearTimeout(h) }, [q])
  const res = useMemo(() => { const s = q.toLowerCase(); if (!s) return PAGES
    const hb: R[] = SECS.flatMap(x => x.items.filter(i => (i.t + i.d).toLowerCase().includes(s)).map(i => ({ label: i.t, sub: 'Handbook · ' + x.title, to: `/handbook?q=${encodeURIComponent(i.t)}` })))
    const pj: R[] = (list as { title: string; year: string }[]).filter(p => p.title.toLowerCase().includes(s)).slice(0, 6).map(p => ({ label: p.title, sub: 'Project · ' + p.year, to: `/projects?q=${encodeURIComponent(p.title)}` }))
    return [...PAGES.filter(p => p.label.toLowerCase().includes(s)), ...found, ...hb.slice(0, 8), ...pj] }, [q, found])
  const go = (r: R) => { nav(r.to); onClose() }
  return <div className="fixed inset-0 z-30 grid place-items-start justify-center pt-24 p-4" style={{ background: 'rgba(0,0,0,.5)' }} onClick={onClose}>
    <motion.div initial={{ opacity: 0, y: -10, scale: .98 }} animate={{ opacity: 1, y: 0, scale: 1 }} className="card w-full max-w-xl" onClick={e => e.stopPropagation()} role="dialog" aria-label="Search everything">
      <input autoFocus className="input" placeholder="Search notes, attachments, handbook, projects and pages…" value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => e.key === 'Enter' && res[0] && go(res[0])} />
      <ul className="mt-3 max-h-80 overflow-auto">{res.map(r => <li key={r.to + r.label}><button className="w-full text-left rounded-xl px-3 py-2 hover:bg-[var(--surface2)]" onClick={() => go(r)}>{r.label}<div className="text-sm text-slate-400">{r.sub}</div></button></li>)}</ul></motion.div></div>
}
