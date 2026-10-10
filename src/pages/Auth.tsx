import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { Err } from '../components/ui'
export default function Auth() {
  const [email, setE] = useState(''), [pw, setP] = useState(''), [err, setErr] = useState<string | null>(null), [info, setInfo] = useState('')
  const go = async (up: boolean) => { setErr(null); setInfo('')
    const { error, data } = up ? await supabase.auth.signUp({ email, password: pw }) : await supabase.auth.signInWithPassword({ email, password: pw })
    if (error) setErr(error.message); else if (up && !data.session) setInfo('Check your email to confirm, then sign in.') }
  return <div className="max-w-sm mx-auto mt-24 space-y-3 p-4"><h1 className="text-xl font-semibold">Project Mission Control</h1><Err msg={err} />{info && <p className="text-sm text-emerald-400">{info}</p>}
    <input className="input" type="email" placeholder="Email" value={email} onChange={e => setE(e.target.value)} /><input className="input" type="password" placeholder="Password (min 6)" value={pw} onChange={e => setP(e.target.value)} />
    <div className="flex gap-2"><button className="btn" onClick={() => go(false)}>Sign in</button><button className="btn" onClick={() => go(true)}>Create account</button></div></div>
}
