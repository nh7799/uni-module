import { useSettings, type Settings } from '../lib/settings'
import { useState } from 'react'
import { Title } from '../components/ui'
import { loadConfig, saveConfig } from '../lib/attachments/config'
function ImageSettings() {
  const [c, setC] = useState(loadConfig); const [saved, setSaved] = useState(false)
  const upd = (p: Partial<typeof c>) => { const n = { ...c, ...p }; saveConfig(n); setC(loadConfig()); setSaved(true) }
  const num = (k: 'maxDisplayDim' | 'thumbDim', label: string, lo: number, hi: number) => <label className="text-sm text-slate-400 font-medium">{label}<input className="input" type="number" min={lo} max={hi} value={c[k]} onChange={e => upd({ [k]: Number(e.target.value) })} /></label>
  return <section className="card mb-4"><h2 className="font-semibold mb-3">Attachments & images</h2>
    <div className="flex flex-wrap gap-2 mb-3"><button className="pill" aria-pressed={c.retainOriginals} onClick={() => upd({ retainOriginals: true })}>Keep originals + optimized copy</button><button className="pill" aria-pressed={!c.retainOriginals} onClick={() => upd({ retainOriginals: false })}>Optimized copy only (saves storage)</button></div>
    <div className="grid gap-3 sm:grid-cols-3">{num('maxDisplayDim', 'Max image size (px)', 800, 6000)}{num('thumbDim', 'Thumbnail size (px)', 100, 800)}
      <label className="text-sm text-slate-400 font-medium">Quality ({Math.round(c.quality * 100)}%)<input className="input" type="range" min={0.5} max={0.95} step={0.01} value={c.quality} onChange={e => upd({ quality: Number(e.target.value) })} /></label></div>
    <p className="text-xs text-slate-500 mt-2">{c.retainOriginals ? 'The untouched original is stored too, so nothing is lost.' : 'Only the optimized version is stored; the original cannot be recovered later.'} Applies to new uploads on this device. Limits: {Math.round(c.maxUploadBytes / 1048576)} MB per file, {c.maxPixels / 1e6} megapixels.{saved && ' ✓ Saved'}</p></section>
}
function Group<K extends keyof Settings>({ label, k, opts }: { label: string; k: K; opts: [string, Settings[K]][] }) {
  const { s, set } = useSettings()
  return <section className="card mb-4"><h2 className="font-semibold mb-3">{label}</h2><div className="flex flex-wrap gap-2">{opts.map(([n, val]) => <button key={n} className="pill" aria-pressed={s[k] === val} onClick={() => set({ [k]: val } as Partial<Settings>)}>{n}</button>)}</div></section>
}
export default function SettingsPage() {
  return <div><Title sub="Changes apply instantly and are remembered on this device.">Make it comfortable</Title>
    <Group label="Theme" k="theme" opts={[['Calm light', 'light'], ['Soft sepia', 'sepia'], ['Calm dark', 'dark'], ['High contrast', 'contrast']]} />
    <Group label="Accent colour" k="accent" opts={[['Blue', 'blue'], ['Teal', 'teal'], ['Violet', 'violet'], ['Green', 'green'], ['Amber', 'amber']]} />
    <Group label="Text size" k="size" opts={[['Normal', 16], ['Large', 20], ['Extra large', 24], ['Huge', 28]]} />
    <Group label="Font" k="font" opts={[['Standard', 'system'], ['Easy to read', 'readable'], ['Serif', 'serif'], ['Monospace', 'mono']]} />
    <Group label="Line spacing" k="spacing" opts={[['Tight', 1.4], ['Relaxed', 1.6], ['Airy', 1.9]]} />
    <Group label="Animations" k="motion" opts={[['On (gentle)', true], ['Off (no movement)', false]]} />
    <ImageSettings />
    <p className="card">Preview: this is how your text looks. Pick whatever makes reading effortless.</p></div>
}
