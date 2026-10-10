import { useState } from 'react'
import { useRows } from '../hooks/useRows'
import { AddForm, Err, Title } from '../components/ui'
import type { Decision } from '../types'
export default function Decisions() {
  const { rows, error, add, remove } = useRows<Decision>('decisions'); const [q, setQ] = useState('')
  const shown = rows.filter(r => JSON.stringify(r).toLowerCase().includes(q.toLowerCase()))
  return <div><Title>Decisions</Title><Err msg={error} />
    <AddForm label="Record decision" onAdd={add} fields={[{ name: 'question', label: 'Problem / question', required: true }, { name: 'chosen', label: 'Chosen option' }, { name: 'reason', label: 'Reason' }, { name: 'alternatives', label: 'Alternatives' }, { name: 'confidence', label: 'Confidence (1-5)', type: 'number' }, { name: 'decided_on', label: 'Date', type: 'date' }]} />
    <input className="input mb-4" placeholder="Search decisions…" value={q} onChange={e => setQ(e.target.value)} />
    {shown.map(r => <div key={r.id} className="border-b border-slate-800 py-4"><div className="flex justify-between"><b>{r.question}</b><button className="text-slate-500" onClick={() => remove(r.id)}>✕</button></div>
      <div>Chosen: {r.chosen}</div><div className="text-slate-400">Why: {r.reason} · Alternatives: {r.alternatives} · Confidence: {r.confidence ?? '–'}/5 · {r.decided_on}</div></div>)}</div>
}
