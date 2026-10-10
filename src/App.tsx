import { useEffect, useState } from 'react'
import { BrowserRouter, NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { MotionConfig, motion } from 'framer-motion'
import type { Session } from '@supabase/supabase-js'
import { configured, supabase } from './lib/supabase'
import { SettingsProvider, useSettings } from './lib/settings'
import Palette from './components/Palette'
import Home from './pages/Home'
import Checklist from './pages/Checklist'
import Handbook from './pages/Handbook'
import Projects from './pages/Projects'
import { AddForm } from './components/ui'
import Auth from './pages/Auth'
import Today from './pages/Today'
import Timeline from './pages/Timeline'
import Tasks from './pages/Tasks'
import Decisions from './pages/Decisions'
import Blockers from './pages/Blockers'
import SettingsPage from './pages/Settings'
import Library from './pages/Library'
import ExportPage from './pages/Export'
import Health from './pages/Health'
import Modules from './pages/Modules'
import ModuleDetail from './pages/ModuleDetail'
const NAV: [string, string, string][] = [['modules', '🎓', 'Modules'], ['home', '🧭', 'Home'], ['today', '☀️', 'Today'], ['checklist', '☑️', 'Checklist'], ['handbook', '📖', 'Handbook'], ['library', '📚', 'Library'], ['projects', '🗂️', 'Projects'], ['timeline', '📅', 'Timeline'], ['tasks', '✅', 'Tasks'], ['decisions', '⚖️', 'Decisions'], ['blockers', '🚧', 'Blockers'], ['export', '📦', 'Export'], ['health', '🩺', 'Health'], ['settings', '🎨', 'Settings']]
const CAP: Record<string, { table: string; fields: Parameters<typeof AddForm>[0]['fields'] }> = {
  Task: { table: 'tasks', fields: [{ name: 'title', label: 'Task', required: true }, { name: 'tier', label: 'Scope', options: ['core', 'important', 'optional', 'stretch'] }] },
  Decision: { table: 'decisions', fields: [{ name: 'question', label: 'Question', required: true }, { name: 'chosen', label: 'Chosen' }, { name: 'reason', label: 'Reason' }] },
  Blocker: { table: 'blockers', fields: [{ name: 'title', label: 'Blocker', required: true }, { name: 'severity', label: 'Severity', options: ['medium', 'low', 'high'] }] } }
function Capture({ onClose }: { onClose: () => void }) {
  const [t, setT] = useState('Task'); const [err, setErr] = useState('')
  return <div className="fixed inset-0 z-20 grid place-items-center p-4" style={{ background: 'rgba(0,0,0,.5)' }} onClick={onClose}><div className="card pop w-full max-w-lg" onClick={e => e.stopPropagation()} role="dialog" aria-label="Quick capture">
    <div className="flex gap-2 mb-3">{Object.keys(CAP).map(k => <button key={k} className="pill" aria-pressed={t === k} onClick={() => setT(k)}>{k}</button>)}<button className="ml-auto" onClick={onClose} aria-label="Close">✕</button></div>
    {err && <p className="danger mb-2">{err}</p>}
    <AddForm key={t} label={`Save ${t.toLowerCase()}`} fields={CAP[t].fields} onAdd={async v => { const { error } = await supabase.from(CAP[t].table).insert(v); if (error) setErr(error.message); else onClose() }} /></div></div>
}
function Shell() {
  const [cap, setCap] = useState(false); const [pal, setPal] = useState(false); const loc = useLocation(); const { s } = useSettings()
  useEffect(() => { const h = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setPal(p => !p) } }; window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h) }, [])
  return <MotionConfig reducedMotion={s.motion ? 'user' : 'always'}><aside className="hidden md:flex fixed inset-y-0 left-0 w-60 flex-col overflow-y-auto gap-1 p-3 border-r" style={{ borderColor: 'var(--line)', background: 'var(--surface)' }}>
      <div className="font-bold p-2 text-lg">🎓 Module Manager</div><button className="pill text-left mb-2 text-slate-400" onClick={() => setPal(true)}>🔍 Search <span className="kbd">Ctrl K</span></button>
      {NAV.map(([p, e, l]) => <NavLink key={p} to={'/' + p} className="rounded-xl px-3 py-2" style={({ isActive }) => ({ background: isActive ? 'var(--surface2)' : 'transparent', fontWeight: isActive ? 700 : 400 })}>{e} {l}</NavLink>)}
      <button className="mt-auto text-left px-3 py-2 text-slate-400" onClick={() => supabase.auth.signOut()}>Sign out</button></aside>
    <nav className="md:hidden fixed bottom-0 inset-x-0 z-10 flex overflow-x-auto gap-3 px-2 py-1 border-t text-xs" style={{ borderColor: 'var(--line)', background: 'var(--surface)' }}>
      {NAV.map(([p, e, l]) => <NavLink key={p} to={'/' + p} className="text-center px-1" style={({ isActive }) => ({ fontWeight: isActive ? 700 : 400 })}><div>{e}</div>{l}</NavLink>)}</nav>
    <main className="md:ml-60 max-w-4xl mx-auto p-5 pb-32"><motion.div key={loc.pathname} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, ease: "easeOut" }}><Routes location={loc}><Route path="/" element={<Navigate to="/modules" />} /><Route path="/modules" element={<Modules />} /><Route path="/modules/:id" element={<ModuleDetail />} /><Route path="/home" element={<Home />} /><Route path="/checklist" element={<Checklist />} /><Route path="/handbook" element={<Handbook />} /><Route path="/projects" element={<Projects />} /><Route path="/today" element={<Today />} /><Route path="/timeline" element={<Timeline />} /><Route path="/tasks" element={<Tasks />} /><Route path="/decisions" element={<Decisions />} /><Route path="/blockers" element={<Blockers />} /><Route path="/library" element={<Library />} /><Route path="/export" element={<ExportPage />} /><Route path="/health" element={<Health />} /><Route path="/settings" element={<SettingsPage />} /><Route path="*" element={<Navigate to="/modules" />} /></Routes></motion.div></main>
    <button className="btn big fixed bottom-20 md:bottom-6 right-5 z-10 rounded-full" onClick={() => setCap(true)} aria-label="Quick capture" style={{ boxShadow: '0 4px 14px rgba(0,0,0,.25)' }}>＋ Capture</button>
    {cap && <Capture onClose={() => { setCap(false); location.reload() }} />}{pal && <Palette onClose={() => setPal(false)} />}</MotionConfig>
}
export default function App() {
  const [session, setSession] = useState<Session | null>(null); const [loading, setLoading] = useState(true)
  useEffect(() => { if (!configured) { setLoading(false); return }
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setLoading(false) })
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s)); return () => sub.subscription.unsubscribe() }, [])
  return <SettingsProvider>{!configured ? <div className="max-w-xl mx-auto mt-24 p-4"><h1 className="text-2xl font-bold mb-2">Supabase not configured</h1><p>Set <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_PUBLISHABLE_KEY</code> (in <code>.env.local</code> or Vercel), run the SQL migrations, and rebuild.</p></div>
    : loading ? <p className="p-6">Loading…</p> : !session ? <Auth /> : <BrowserRouter><Shell /></BrowserRouter>}</SettingsProvider>
}
