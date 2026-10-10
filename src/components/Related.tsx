import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { Parent } from '../lib/attachments/types'
import { LABELS, ROUTE, TYPE_LABEL, addRelation, loadLinks, removeRelation, searchTargets, titlesFor, type Linked } from '../lib/relations'
export default function Related({ parent, selfTitle }: { parent: Parent; selfTitle?: string }) {
  const [links, setLinks] = useState<Linked[]>([]); const [q, setQ] = useState(''); const [label, setLabel] = useState('related to'); const [hits, setHits] = useState<{ ref: Parent; title: string }[]>([]); const [err, setErr] = useState<string | null>(null); const [graph, setGraph] = useState(false); const [title, setTitle] = useState(selfTitle ?? '…'); const nav = useNavigate()
  const load = useCallback(async () => setLinks(await loadLinks(parent)), [parent.type, parent.id])
  useEffect(() => { load() }, [load])
  useEffect(() => { if (!selfTitle) titlesFor([parent]).then(m => setTitle(m.get(`${parent.type}:${parent.id}`) ?? '(untitled)')) }, [parent.type, parent.id, selfTitle])
  useEffect(() => { const t = setTimeout(async () => setHits(await searchTargets(q, parent)), 250); return () => clearTimeout(t) }, [q, parent.type, parent.id])
  const add = async (to: Parent) => { const { error } = await addRelation(parent, to, label); if (error) setErr(error.code === '23505' ? 'That relationship already exists.' : error.message); else { setErr(null); setQ(''); await load() } }
  const del = async (l: Linked) => { if (!confirm(`Remove the link "${l.rel.label}" with "${l.title}"? Neither record is deleted.`)) return; const { error } = await removeRelation(l.rel.id); if (error) setErr(error.message); await load() }
  const go = (l: Linked) => nav(ROUTE[l.other.type](l.other.id))
  return <section aria-label="Related records" className="mt-3">
    {err && <p className="danger mb-2">{err}</p>}
    {links.length ? <ul className="space-y-1">{links.map(l => <li key={l.rel.id} className="flex gap-2 items-center"><span className="text-xs text-slate-400 w-28 shrink-0">{l.dir === 'out' ? l.rel.label + ' →' : '← ' + l.rel.label}</span>
      <button className="underline text-left flex-1" onClick={() => go(l)}>{l.title}</button><span className="text-xs text-slate-500">{TYPE_LABEL[l.other.type]}</span><button className="text-slate-500" aria-label={`Remove link to ${l.title}`} onClick={() => del(l)}>✕</button></li>)}</ul> : <p className="text-slate-400">Nothing linked yet. Links show up on both records (as backlinks).</p>}
    <div className="grid gap-2 sm:grid-cols-[10rem_1fr] mt-3"><input className="input" list="rel-labels" value={label} onChange={e => setLabel(e.target.value)} aria-label="Relationship label" /><datalist id="rel-labels">{LABELS.map(l => <option key={l} value={l} />)}</datalist>
      <input className="input" placeholder="Search a record, task, deadline… to link" value={q} onChange={e => setQ(e.target.value)} aria-label="Find a record to link" /></div>
    {hits.length > 0 && <ul className="card mt-1 p-1">{hits.map(h => <li key={h.ref.type + h.ref.id}><button className="w-full text-left px-3 py-1 rounded hover:bg-[var(--surface2)]" onClick={() => add(h.ref)}>{h.title} <span className="text-xs text-slate-500">· {TYPE_LABEL[h.ref.type]}</span></button></li>)}</ul>}
    {links.length > 0 && <button className="pill mt-3 text-sm" aria-pressed={graph} onClick={() => setGraph(!graph)}>🕸 {graph ? 'Hide' : 'Show'} relationship map</button>}
    {graph && <Graph centre={title} links={links} go={go} />}</section>
}
function Graph({ centre, links, go }: { centre: string; links: Linked[]; go: (l: Linked) => void }) {
  const W = 560, H = 360, cx = W / 2, cy = H / 2, R = 135, n = links.length, short = (s: string) => s.length > 22 ? s.slice(0, 21) + '…' : s
  return <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Relationship map of ${centre} with ${n} linked records`} className="w-full card mt-2 p-0">
    {links.map((l, i) => { const a = (2 * Math.PI * i) / n - Math.PI / 2, x = cx + R * 1.5 * Math.cos(a), y = cy + R * Math.sin(a); return <g key={l.rel.id}>
      <line x1={cx} y1={cy} x2={x} y2={y} stroke="var(--line)" strokeWidth="2" /><text x={(cx + x) / 2} y={(cy + y) / 2} fontSize="10" textAnchor="middle" fill="var(--muted)">{l.dir === 'out' ? l.rel.label : '← ' + l.rel.label}</text>
      <g tabIndex={0} role="link" aria-label={`Open ${l.title}`} style={{ cursor: 'pointer' }} onClick={() => go(l)} onKeyDown={e => e.key === 'Enter' && go(l)}><rect x={x - 62} y={y - 14} width="124" height="28" rx="8" fill="var(--surface2)" stroke="var(--accent)" /><text x={x} y={y + 4} fontSize="11" textAnchor="middle" fill="var(--ink)">{short(l.title)}</text></g></g> })}
    <circle cx={cx} cy={cy} r="38" fill="var(--accent)" /><text x={cx} y={cy + 4} fontSize="11" textAnchor="middle" fill="var(--on-accent)" fontWeight="700">{short(centre)}</text></svg>
}
