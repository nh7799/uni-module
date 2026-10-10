import { useRows } from '../hooks/useRows'
import { AddForm, Err, Title } from '../components/ui'
import RecordExtras from '../components/RecordExtras'
import type { Task } from '../types'
export default function Tasks() {
  const { rows, error, add, update, remove } = useRows<Task>('tasks')
  const top = rows.filter(t => !t.parent_id), kids = (id: string) => rows.filter(t => t.parent_id === id)
  const core = top.filter(t => t.tier === 'core' && t.status === 'todo').length, stretch = top.filter(t => t.tier === 'stretch' && t.status === 'todo').length
  const addSub = async (p: Task) => { const title = prompt(`Subtask of "${p.title}"`)?.trim(); if (title) await add({ title, tier: p.tier, parent_id: p.id }) }
  const del = (t: Task) => { const n = kids(t.id).length; if (n) return alert(`"${t.title}" has ${n} subtask(s). Delete or move them first; nothing was deleted.`); if (confirm(`Delete "${t.title}"? Its attachments and links are removed too.`)) remove(t.id, false) }
  const item = (t: Task, sub = false) => <li key={t.id} className={'py-3 ' + (sub ? 'ml-8' : '')}><div className="flex gap-3 items-center">
    <input type="checkbox" checked={t.status === 'done'} onChange={() => update(t.id, { status: t.status === 'done' ? 'todo' : 'done' })} aria-label={`Mark ${t.title} done`} />
    <span className={'flex-1 ' + (t.status === 'done' ? 'line-through text-slate-500' : '')}>{t.title}</span>{!sub && <span className="text-xs uppercase text-slate-400">{t.tier}</span>}{t.due && <span className="text-xs text-slate-500">{t.due}</span>}
    {!sub && <button className="text-slate-400 text-sm" onClick={() => addSub(t)}>+ sub</button>}<button className="text-slate-500" onClick={() => del(t)} aria-label={`Delete ${t.title}`}>✕</button></div>
    <RecordExtras parent={{ type: 'tasks', id: t.id }} title={t.title} /></li>
  return <div><Title>Tasks</Title><Err msg={error} />
    {core > 0 && stretch > 0 && <p className="warn mb-4">Scope guard: {stretch} stretch task(s) open while {core} core task(s) remain. Finish core first.</p>}
    <AddForm label="Add task" onAdd={add} fields={[{ name: 'title', label: 'Task', required: true }, { name: 'tier', label: 'Scope', options: ['core', 'important', 'optional', 'stretch'] }, { name: 'due', label: 'Due', type: 'date' }]} />
    <ul className="divide-y divide-slate-800">{top.flatMap(t => [item(t), ...kids(t.id).map(k => item(k, true))])}</ul></div>
}
