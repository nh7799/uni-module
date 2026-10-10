import { useEffect, useState } from 'react'
import { supabase } from './supabase'
export function useUserId() {
  const [id, setId] = useState<string | null>(null)
  useEffect(() => { supabase.auth.getSession().then(({ data }) => setId(data.session?.user.id ?? null)) }, [])
  return id
}
