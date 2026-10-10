import { useRows } from '../hooks/useRows'
import { daysUntil } from '../utils/dates'
import { AddForm, Err, Title } from '../components/ui'
import type { EventRow } from '../types'
const UH = [['Project Selection (Canvas, 17:00)','2026-10-15','official'],['Project Outline (17:00)','2026-11-16','official'],['Report submission (15:00)','2027-04-09','official'],['Viva window opens','2027-04-12','official'],['Viva window closes','2027-04-23','official'],
['Outline — personal target','2026-11-09','personal'],['Prototype — personal target','2026-12-18','personal'],['Core complete — personal target','2027-01-29','personal'],['Implementation freeze','2027-03-05','personal'],['Full report draft','2027-03-19','personal'],['Report submit — personal target','2027-04-02','personal'],['Report — warning date','2027-04-06','warning']]
export default function Timeline() {
  const { rows, error, add, update, remove } = useRows<EventRow>('events', 'date', true)
  return <div><Title sub="Official dates are fixed. Personal targets give you a safety margin.">Timeline</Title><Err msg={error} />
    <AddForm label="Add event" onAdd={add} fields={[{ name: 'title', label: 'Title', required: true }, { name: 'date', label: 'Date', type: 'date', required: true }, { name: 'kind', label: 'Type', options: ['official', 'personal', 'warning', 'milestone'] }]} />
    {rows.length === 0 && <button className="btn mb-4" onClick={async () => { for (const [title, date, kind] of UH) await add({ title, date, kind }) }}>Load UH 2026/27 dates (from handbook v0.9 — verify on Canvas)</button>}
    <ul className="divide-y divide-slate-800">{rows.map(e => { const n = daysUntil(e.date); return <li key={e.id} className="py-3 flex items-center gap-3">
      <input type="checkbox" checked={e.done} onChange={() => update(e.id, { done: !e.done })} />
      <span className="w-20 text-xs uppercase text-slate-400">{e.kind}</span><span className="flex-1">{e.title}<span className="text-slate-500"> · {e.date}</span></span>
      <span className={e.done ? 'text-slate-500' : n < 0 ? 'font-bold' : n < 7 ? 'font-bold' : ''}>{e.done ? 'done' : n < 0 ? `${-n}d overdue` : `${n}d`}</span>
      <button className="text-slate-500" onClick={() => remove(e.id)}>✕</button></li> })}</ul></div>
}
