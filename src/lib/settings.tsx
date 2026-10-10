import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
export interface Settings { theme: string; accent: string; size: number; font: string; spacing: number; motion: boolean }
const DEF: Settings = { theme: 'light', accent: 'blue', size: 20, font: 'system', spacing: 1.6, motion: true }
const FONTS: Record<string, string> = { system: 'ui-sans-serif,system-ui,"Segoe UI",sans-serif', readable: 'Verdana,Tahoma,sans-serif', serif: 'Georgia,"Times New Roman",serif', mono: 'ui-monospace,Menlo,Consolas,monospace' }
const Ctx = createContext<{ s: Settings; set: (p: Partial<Settings>) => void }>({ s: DEF, set: () => {} })
export const useSettings = () => useContext(Ctx)
export function SettingsProvider({ children }: { children: ReactNode }) {
  const [s, setS] = useState<Settings>(() => { try { return { ...DEF, ...JSON.parse(localStorage.getItem('ui-settings') || '{}') } } catch { return DEF } })
  useEffect(() => { const r = document.documentElement; r.dataset.theme = s.theme; r.dataset.accent = s.accent; r.dataset.motion = s.motion ? 'on' : 'off'
    r.style.setProperty('--fs', String(s.size)); r.style.setProperty('--lh', String(s.spacing)); r.style.setProperty('--font', FONTS[s.font] ?? FONTS.system)
    try { localStorage.setItem('ui-settings', JSON.stringify(s)) } catch { /* UI preferences only */ } }, [s])
  return <Ctx.Provider value={{ s, set: p => setS(o => ({ ...o, ...p })) }}>{children}</Ctx.Provider>
}
