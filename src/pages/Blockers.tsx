import { useRows } from '../hooks/useRows'
import { AddForm, Err, Title } from '../components/ui'
import type { Blocker } from '../types'
export default function Blockers() {
  const { rows, error, add, update, remove } = useRows<Blocker>('blockers')
  return <div><Title>Blockers</Title><Err msg={error} />
    <AddForm label="Add blocker" onAdd={add} fields={[{ name: 'title', label: 'Blocker', required: true }, { name: 'severity', label: 'Severity', options: ['medium', 'low', 'high'] }, { name: 'next_action', label: 'Next action' }]} />
    <ul className="divide-y divide-slate-800">{rows.map(b => <li key={b.id} className="py-3 flex gap-3 items-center">
      <span className={'flex-1 ' + (b.status === 'resolved' ? 'line-through text-slate-500' : '')}>{b.title}<span className="text-slate-500"> · next: {b.next_action ?? '–'}</span></span><span className="text-xs uppercase text-slate-400">{b.severity}</span>
      <button className="text-sky-400" onClick={() => update(b.id, { status: b.status === 'open' ? 'resolved' : 'open' })}>{b.status === 'open' ? 'Resolve' : 'Reopen'}</button>
      <button className="text-slate-500" onClick={() => remove(b.id)}>✕</button></li>)}</ul></div>
}
