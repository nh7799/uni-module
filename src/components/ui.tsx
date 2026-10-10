import { useState, type ReactNode } from 'react'
export const input = 'input'
export const btn = 'btn'
export const Err = ({ msg }: { msg: string | null }) => msg ? <p className="danger my-3">Something went wrong: {msg}</p> : null
export const Title = ({ children, sub }: { children: ReactNode; sub?: string }) => <header className="mb-6"><h1 className="text-2xl font-bold">{children}</h1>{sub && <p className="text-slate-400">{sub}</p>}</header>
type F = { name: string; label: string; type?: string; options?: string[]; required?: boolean }
export function AddForm({ fields, onAdd, label = 'Add' }: { fields: F[]; onAdd: (v: Record<string, unknown>) => Promise<void>; label?: string }) {
  const [v, setV] = useState<Record<string, string>>({})
  return <form className="card grid gap-3 sm:grid-cols-2 mb-6" onSubmit={async e => {
    e.preventDefault(); const out: Record<string, unknown> = {}
    for (const f of fields) { const val = v[f.name] ?? (f.options ? f.options[0] : undefined); if (val !== undefined && val !== '') out[f.name] = f.type === 'number' ? Number(val) : val }
    await onAdd(out); setV({}) }}>
    {fields.map(f => <label key={f.name} className="text-sm text-slate-400 font-medium">{f.label}
      {f.options ? <select className="input" value={v[f.name] ?? f.options[0]} onChange={e => setV({ ...v, [f.name]: e.target.value })}>{f.options.map(o => <option key={o}>{o}</option>)}</select>
        : <input className="input" type={f.type ?? 'text'} required={f.required} value={v[f.name] ?? ''} onChange={e => setV({ ...v, [f.name]: e.target.value })} />}</label>)}
    <button className="btn sm:col-span-2">{label}</button></form>
}
import { motion } from 'framer-motion'
export const Bar = ({ pct }: { pct: number }) => <div className="bar"><motion.i initial={{ width: 0 }} animate={{ width: `${pct}%` }} transition={{ duration: 0.7, ease: 'easeOut' }} /></div>
export const stagger = (i: number) => ({ initial: { opacity: 0, y: 10 }, animate: { opacity: 1, y: 0 }, transition: { delay: Math.min(i, 12) * 0.03, duration: 0.25 } })
