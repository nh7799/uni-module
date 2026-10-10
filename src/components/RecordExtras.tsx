import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { Parent } from '../lib/attachments/types'
import Attachments from './Attachments'
import Related from './Related'
/** One collapsible 📎/🔗 panel that can be dropped into any list item. */
export default function RecordExtras({ parent, title }: { parent: Parent; title?: string }) {
  const [open, setOpen] = useState<'att' | 'rel' | null>(null); const [counts, setCounts] = useState<[number, number] | null>(null)
  const count = async () => { const [a, r1, r2] = await Promise.all([supabase.from('attachments').select('id', { count: 'exact', head: true }).eq('parent_type', parent.type).eq('parent_id', parent.id).neq('status', 'pending_deletion'), supabase.from('relations').select('id', { count: 'exact', head: true }).eq('from_type', parent.type).eq('from_id', parent.id), supabase.from('relations').select('id', { count: 'exact', head: true }).eq('to_type', parent.type).eq('to_id', parent.id)]); setCounts([a.count ?? 0, (r1.count ?? 0) + (r2.count ?? 0)]) }
  useEffect(() => { count() }, [parent.type, parent.id])
  return <div className="mt-1"><div className="flex gap-2 text-sm"><button className="pill py-0" aria-pressed={open === 'att'} onClick={() => setOpen(open === 'att' ? null : 'att')}>📎 {counts ? counts[0] : '…'}</button><button className="pill py-0" aria-pressed={open === 'rel'} onClick={() => setOpen(open === 'rel' ? null : 'rel')}>🔗 {counts ? counts[1] : '…'}</button></div>
    {open === 'att' && <Attachments parent={parent} onChange={count} />}{open === 'rel' && <Related parent={parent} selfTitle={title} />}</div>
}
