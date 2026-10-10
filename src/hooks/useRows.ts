import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
export function useRows<T extends { id: string }>(table: string, order = 'created_at', asc = false) {
  const [rows, setRows] = useState<T[]>([]); const [loading, setLoading] = useState(true); const [error, setError] = useState<string | null>(null)
  const load = useCallback(async () => {
    setLoading(true)
    const { data, error } = await supabase.from(table).select('*').order(order, { ascending: asc })
    if (error) setError(error.message); else { setError(null); setRows(data as T[]) }
    setLoading(false)
  }, [table, order, asc])
  useEffect(() => { load() }, [load])
  const run = async (p: PromiseLike<{ error: { message: string } | null }>) => { const { error } = await p; setError(error ? error.message : null); await load() }
  const add = (v: Record<string, unknown>) => run(supabase.from(table).insert(v))
  const update = (id: string, v: Record<string, unknown>) => run(supabase.from(table).update(v).eq('id', id))
  const remove = (id: string, ask = true) => (!ask || confirm('Delete this record?')) ? run(supabase.from(table).delete().eq('id', id)) : Promise.resolve()
  return { rows, loading, error, add, update, remove }
}
