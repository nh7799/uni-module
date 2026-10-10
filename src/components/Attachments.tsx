import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useUserId } from '../lib/session'
import { loadConfig } from '../lib/attachments/config'
import { fmtBytes, makeService } from '../lib/attachments/instance'
import { runOcr } from '../lib/attachments/ocr'
import { dbPort, storagePort } from '../lib/attachments/supabasePorts'
import { UploadError, type AttachmentRow, type Parent, type Stage, type Status } from '../lib/attachments/types'
const LABEL: Record<Status, string> = { uploading: 'Uploading', processing: 'Processing', stored: 'Stored · verifying', available: 'Available', failed: 'Failed', pending_deletion: 'Pending deletion' }
const STAGES: Stage[] = ['validating', 'saving record', 'processing', 'uploading', 'verifying', 'done']
interface Job { key: number; name: string; stage: Stage | null; error?: string; notes: string[]; done?: boolean }
const toInput = (f: File) => ({ name: f.name, size: f.size, type: f.type, bytes: async () => new Uint8Array(await f.arrayBuffer()) })
const signed = async (paths: string[]) => { const m = new Map<string, string>(); if (!paths.length) return m; const { data } = await supabase.storage.from('attachments').createSignedUrls(paths, 3600); data?.forEach(d => { if (d.path && d.signedUrl) m.set(d.path, d.signedUrl) }); return m }
export function useAttachments(parent: Parent) {
  const [rows, setRows] = useState<AttachmentRow[]>([]); const [urls, setUrls] = useState<Map<string, string>>(new Map()); const [loading, setLoading] = useState(true)
  const load = useCallback(async () => { const r = await dbPort.list(parent); setRows(r); setUrls(await signed(r.map(a => a.thumb_path ?? (a.kind === 'image' ? a.display_path : null)).filter((p): p is string => !!p))); setLoading(false) }, [parent.type, parent.id])
  useEffect(() => { load() }, [load])
  return { rows, urls, loading, load }
}
export default function Attachments({ parent, onChange }: { parent: Parent; onChange?: () => void }) {
  const userId = useUserId(); const cfg = useMemo(loadConfig, []); const svc = useMemo(() => userId ? makeService(userId, cfg) : null, [userId, cfg])
  const { rows, urls, loading, load } = useAttachments(parent); const [jobs, setJobs] = useState<Job[]>([]); const [drag, setDrag] = useState(false); const [msg, setMsg] = useState<string | null>(null); const pick = useRef<HTMLInputElement>(null); const seq = useRef(0)
  const refresh = async () => { await load(); onChange?.() }
  const patch = (key: number, p: Partial<Job>) => setJobs(j => j.map(x => x.key === key ? { ...x, ...p } : x))
  const addFiles = async (files: File[]) => {
    if (!svc) return setMsg('Still signing in; try again in a moment.')
    for (const f of files) {
      const key = ++seq.current; setJobs(j => [...j, { key, name: f.name, stage: 'validating', notes: [] }])
      try { const r = await svc.upload(parent, toInput(f), { onStage: s => patch(key, { stage: s }) }); patch(key, { stage: 'done', done: true, notes: r.notes }) }
      catch (e) { patch(key, { stage: null, error: e instanceof Error ? e.message : String(e), notes: e instanceof UploadError && e.code === 'processing_failed' ? ['The original was saved. Use "Retry processing" on the item below.'] : [] }) }
      await refresh()
    }
  }
  const onPaste = (e: React.ClipboardEvent) => { const fs = [...e.clipboardData.items].filter(i => i.kind === 'file' && i.type.startsWith('image/')).map(i => i.getAsFile()!).filter(Boolean); if (fs.length) { e.preventDefault(); addFiles(fs.map(f => new File([f], `pasted-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.${f.type.split('/')[1] || 'png'}`, { type: f.type }))) } }
  const pasteButton = async () => { try { const items = await navigator.clipboard.read(); const fs: File[] = []; for (const it of items) { const t = it.types.find(x => x.startsWith('image/')); if (t) fs.push(new File([await it.getType(t)], `pasted-${Date.now()}.${t.split('/')[1]}`, { type: t })) } fs.length ? addFiles(fs) : setMsg('No image found on the clipboard.') } catch { setMsg('Clipboard access was not allowed. Click the box and press Ctrl+V instead.') } }
  const move = async (i: number, d: -1 | 1) => { const ids = rows.map(r => r.id); [ids[i], ids[i + d]] = [ids[i + d], ids[i]]; try { await svc!.reorder(ids) } catch (e) { setMsg(String(e instanceof Error ? e.message : e)) } await refresh() }
  const busy = jobs.some(j => !j.done && !j.error)
  return <section aria-label="Attachments" className="mt-3" onPaste={onPaste}>
    <div tabIndex={0} role="group" aria-label="Add images or files: drop here, click the box and paste, or use the buttons"
      className="rounded-xl border-2 border-dashed p-4 text-center" style={{ borderColor: drag ? 'var(--accent)' : 'var(--line)', background: drag ? 'var(--surface2)' : 'transparent' }}
      onDragOver={e => { e.preventDefault(); setDrag(true) }} onDragLeave={() => setDrag(false)} onDrop={e => { e.preventDefault(); setDrag(false); addFiles([...e.dataTransfer.files]) }}>
      <p className="text-sm text-slate-400 mb-2">Drop images or PDFs here, click this box and press <span className="kbd">Ctrl</span>+<span className="kbd">V</span> to paste a screenshot, or:</p>
      <div className="flex gap-2 justify-center flex-wrap"><button className="btn" onClick={() => pick.current?.click()} disabled={!svc}>📎 Choose files</button><button className="btn ghost" onClick={pasteButton} disabled={!svc}>📋 Paste from clipboard</button></div>
      <input ref={pick} type="file" hidden multiple accept={cfg.allowedMimes.join(',')} onChange={e => { addFiles([...(e.target.files ?? [])]); e.target.value = '' }} />
      <p className="text-xs text-slate-500 mt-2">JPEG, PNG, WebP, GIF, AVIF, PDF · up to {fmtBytes(cfg.maxUploadBytes)} · {cfg.retainOriginals ? 'originals are kept alongside optimized copies' : 'only optimized copies are kept (originals discarded)'}</p></div>
    {msg && <p className="warn mt-2" role="status">{msg} <button className="underline" onClick={() => setMsg(null)}>dismiss</button></p>}
    {jobs.length > 0 && <ul className="mt-3 space-y-2" aria-live="polite">{jobs.map(j => <li key={j.key} className="card py-2">
      <div className="flex gap-2 items-center"><span className="flex-1 truncate">{j.name}</span>{j.error ? <span className="danger py-0 px-2 text-sm">Not saved</span> : j.done ? <span className="text-sm">✓ Saved and verified</span> : <span className="text-sm text-slate-400">{j.stage}…</span>}<button aria-label="Dismiss" className="text-slate-500" onClick={() => setJobs(x => x.filter(y => y.key !== j.key))}>✕</button></div>
      {!j.done && !j.error && <div className="bar mt-1"><i style={{ width: `${((STAGES.indexOf(j.stage ?? 'validating') + 1) / STAGES.length) * 100}%` }} /></div>}
      {j.error && <p className="danger mt-2">{j.error}</p>}{j.notes.map(n => <p key={n} className="text-sm text-slate-400">{n}</p>)}</li>)}</ul>}
    {busy && <p className="text-sm text-slate-400 mt-1">Please keep this page open until uploads finish.</p>}
    {loading ? <p className="text-slate-400 mt-3">Loading attachments…</p> : <ul className="mt-3 space-y-3">{rows.map((a, i) => <Item key={a.id} a={a} thumb={urls.get(a.thumb_path ?? a.display_path ?? '')} svc={svc} first={i === 0} last={i === rows.length - 1} move={d => move(i, d)} refresh={refresh} setMsg={setMsg} />)}
      {!rows.length && <li className="text-slate-400">No attachments yet.</li>}</ul>}</section>
}
type Svc = NonNullable<ReturnType<typeof makeService>> | null
function Item({ a, thumb, svc, first, last, move, refresh, setMsg }: { a: AttachmentRow; thumb?: string; svc: Svc; first: boolean; last: boolean; move: (d: -1 | 1) => void; refresh: () => Promise<void>; setMsg: (s: string) => void }) {
  const [edit, setEdit] = useState(false); const [view, setView] = useState(false); const [work, setWork] = useState<string | null>(null); const rep = useRef<HTMLInputElement>(null)
  const guard = async (label: string, f: () => Promise<unknown>) => { setWork(label); try { await f() } catch (e) { setMsg(e instanceof Error ? e.message : String(e)) } setWork(null); await refresh() }
  const download = async (path: string | null, name: string) => { if (!path) return; const { data, error } = await supabase.storage.from('attachments').createSignedUrl(path, 60, { download: name }); if (error || !data) return setMsg('Could not create a download link: ' + (error?.message ?? 'unknown error')); const l = document.createElement('a'); l.href = data.signedUrl; l.click() }
  const ext = (p: string | null) => p ? p.slice(p.lastIndexOf('.')) : ''
  return <li className="card">
    <div className="flex gap-3">
      <button className="shrink-0 rounded-lg overflow-hidden border" style={{ width: 96, height: 96, borderColor: 'var(--line)', background: 'var(--surface2)' }} onClick={() => a.status === 'available' && setView(true)} aria-label={`View ${a.filename}`}>
        {thumb ? <img src={thumb} alt={a.alt_text || a.caption || a.filename} loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <span className="text-3xl">{a.kind === 'document' ? '📄' : '🖼️'}</span>}</button>
      <div className="flex-1 min-w-0">
        <div className="flex gap-2 items-center flex-wrap"><b className="truncate">{a.filename}</b><span className="pill text-xs py-0" style={{ borderColor: a.status === 'failed' ? '#d9534f' : undefined }}>{work ?? LABEL[a.status]}</span></div>
        {a.caption && <p className="text-sm">{a.caption}</p>}
        <p className="text-xs text-slate-400">{a.mime.replace('image/', '').toUpperCase()}{a.width ? ` · ${a.width}×${a.height}` : ''} · uploaded {fmtBytes(a.byte_size)}{a.display_bytes && a.display_path !== a.original_path ? ` → stored ${fmtBytes(a.display_bytes)}` : ''}</p>
        {a.status === 'available' && a.kind === 'image' && <p className="text-xs text-slate-400">{a.original_retained ? 'Original kept' : 'Optimized copy only: the original was not kept'}{a.optimized ? ' · compressed for display' : ' · stored as uploaded'}</p>}
        {a.error && <p className={a.status === 'failed' ? 'danger mt-1 text-sm' : 'text-sm text-slate-400'}>{a.error}</p>}
        {a.extracted_text && <p className="text-xs text-slate-400 mt-1">{a.extracted_source === 'ocr' && !a.extracted_edited ? '⚙️ Machine-extracted text (unverified)' : a.extracted_source === 'ocr' ? '⚙️✎ Machine-extracted text, edited by you' : '✎ Text written by you'} · {a.extracted_text.length} characters</p>}
      </div></div>
    <div className="flex gap-2 flex-wrap mt-2 text-sm">
      <button className="pill" onClick={() => setEdit(!edit)} aria-expanded={edit}>✎ Details & text</button>
      {a.status === 'available' && <button className="pill" onClick={() => setView(true)}>🔍 View</button>}
      {a.status === 'failed' && a.original_path && <button className="pill" disabled={!!work} onClick={() => guard('Processing', () => svc!.retryProcessing(a.id))}>↻ Retry processing</button>}
      {a.status === 'available' && <button className="pill" onClick={() => download(a.display_path, a.filename + ext(a.display_path))}>⬇ Download{a.original_retained && a.display_path !== a.original_path ? ' optimized' : ''}</button>}
      {a.original_retained && a.original_path && a.display_path !== a.original_path && <button className="pill" onClick={() => download(a.original_path, a.filename + ext(a.original_path))}>⬇ Original</button>}
      <button className="pill" disabled={first || !!work} onClick={() => move(-1)} aria-label="Move up">▲</button><button className="pill" disabled={last || !!work} onClick={() => move(1)} aria-label="Move down">▼</button>
      <button className="pill" disabled={!!work} onClick={() => rep.current?.click()}>⇄ Replace</button>
      <input ref={rep} type="file" hidden accept="image/*,application/pdf" onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f && confirm(`Replace "${a.filename}" with "${f.name}"? The old file is removed only after the new one is saved and verified.`)) guard('Replacing', () => svc!.replace(a.id, toInput(f))) }} />
      <button className="pill" disabled={!!work} onClick={() => { if (confirm(`Remove "${a.filename}"? The stored file(s) will be permanently deleted. This cannot be undone.`)) guard('Removing', async () => { const r = await svc!.remove(a.id); if (!r.purged && r.error) setMsg(r.error) }) }}>🗑 Remove</button></div>
    {edit && <Editor a={a} svc={svc} done={async () => { await refresh() }} setMsg={setMsg} />}
    {view && <Lightbox a={a} onClose={() => setView(false)} />}</li>
}
function Editor({ a, done, setMsg }: { a: AttachmentRow; svc: Svc; done: () => Promise<void>; setMsg: (s: string) => void }) {
  const init = { filename: a.filename, caption: a.caption, alt_text: a.alt_text, description: a.description, extracted_text: a.extracted_text }
  const [d, setD] = useState(init); const [state, setState] = useState<'saved' | 'saving' | 'error'>('saved'); const [ocr, setOcr] = useState<string | null>(null)
  const dirty = (Object.keys(init) as (keyof typeof init)[]).some(k => d[k] !== init[k])
  const save = async (over: Partial<typeof d> = {}, srcPatch: Record<string, unknown> = {}) => {
    const v = { ...d, ...over }; if (!v.filename.trim()) return setMsg('The filename cannot be empty.')
    setState('saving'); const textChanged = v.extracted_text !== a.extracted_text
    const p: Record<string, unknown> = { filename: v.filename.trim(), caption: v.caption, alt_text: v.alt_text, description: v.description, extracted_text: v.extracted_text, ...srcPatch }
    if (textChanged && !('extracted_source' in srcPatch)) { p.extracted_source = v.extracted_text.trim() ? (a.extracted_source === 'ocr' ? 'ocr' : 'manual') : null; p.extracted_edited = !!v.extracted_text.trim() && a.extracted_source === 'ocr' }
    const { error } = await supabase.from('attachments').update(p).eq('id', a.id)
    if (error) { setState('error'); setMsg('Could not save: ' + error.message) } else { setState('saved'); await done() }
  }
  const doOcr = async () => {
    if (d.extracted_text.trim() && !confirm('Replace the existing extracted text with a new OCR result? Your current text will be overwritten.')) return
    setOcr('Reading the image… the first run downloads the OCR engine and can take a while.')
    try { const src = a.display_path ?? a.original_path; const bytes = src ? await storagePort.download(src) : null; if (!bytes) throw new Error('The stored image could not be downloaded.')
      const r = await runOcr(bytes, a.display_mime ?? a.mime); setD(x => ({ ...x, extracted_text: r.text })); await save({ extracted_text: r.text }, { extracted_source: 'ocr', extracted_edited: false })
      setOcr(r.text ? `Done (engine confidence ${Math.round(r.confidence)}%). OCR can be wrong, especially for handwriting, equations and diagrams: please check it.` : 'No text was found in this image.') }
    catch (e) { setOcr(e instanceof Error ? e.message : String(e)) }
  }
  const f = (k: keyof typeof d, label: string, rows = 0) => <label className="block text-sm text-slate-400 font-medium">{label}{rows ? <textarea className="input" rows={rows} value={d[k]} onChange={e => setD({ ...d, [k]: e.target.value })} /> : <input className="input" value={d[k]} onChange={e => setD({ ...d, [k]: e.target.value })} />}</label>
  return <div className="mt-3 grid gap-3 border-t pt-3" style={{ borderColor: 'var(--line)' }}>
    {f('filename', 'Descriptive name')}{f('caption', 'Caption (shown with the image)')}{f('alt_text', 'Alternative text (what a screen reader should say)')}
    {f('description', 'Description / explanation (for diagrams, graphs and photos; searchable and kept in exports)', 3)}
    <div>{f('extracted_text', 'Text in the image (typed by you or machine-extracted; searchable)', 5)}
      <div className="flex gap-2 mt-1 flex-wrap items-center">{a.kind === 'image' && a.status === 'available' && <button className="pill text-sm" onClick={doOcr}>⚙️ Extract text (OCR)</button>}
        {d.extracted_text && <button className="pill text-sm" onClick={() => { if (confirm('Delete the extracted text? The image itself is not affected.')) save({ extracted_text: '' }, { extracted_source: null, extracted_edited: false }) }}>Delete text</button>}
        <span className="text-xs text-slate-500">OCR never replaces the image and is not reliable for handwriting, maths or complex diagrams. It loads the OCR engine from jsdelivr.net when used.</span></div>
      {ocr && <p className="text-sm text-slate-400 mt-1" role="status">{ocr}</p>}</div>
    <div className="flex gap-3 items-center"><button className="btn" disabled={!dirty || state === 'saving'} onClick={() => save()}>Save</button>
      <span className="text-sm text-slate-400" role="status">{state === 'saving' ? 'Saving…' : state === 'error' ? 'Not saved: try again' : dirty ? '● Unsaved edits' : '✓ Saved to the database'}</span></div></div>
}
function Lightbox({ a, onClose }: { a: AttachmentRow; onClose: () => void }) {
  const [url, setUrl] = useState<string | null>(null); const [zoom, setZoom] = useState(1); const [showOrig, setShowOrig] = useState(false); const [err, setErr] = useState<string | null>(null)
  const canOrig = a.original_retained && !!a.original_path && a.original_path !== a.display_path; const path = showOrig && canOrig ? a.original_path : a.display_path ?? a.original_path
  useEffect(() => { let live = true; setUrl(null); if (path) supabase.storage.from('attachments').createSignedUrl(path, 600).then(({ data, error }) => { if (!live) return; data ? setUrl(data.signedUrl) : setErr(error?.message ?? 'Could not load the file.') }); return () => { live = false } }, [path])
  useEffect(() => { const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose(); window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h) }, [onClose])
  return <div className="fixed inset-0 z-40 flex flex-col p-3" style={{ background: 'rgba(0,0,0,.85)' }} role="dialog" aria-label={`Viewing ${a.filename}`}>
    <div className="flex gap-2 items-center flex-wrap text-white"><b className="flex-1 truncate">{a.filename}</b>
      <button className="pill" onClick={() => setZoom(z => Math.max(0.25, z / 1.25))} aria-label="Zoom out">−</button><span>{Math.round(zoom * 100)}%</span><button className="pill" onClick={() => setZoom(z => Math.min(8, z * 1.25))} aria-label="Zoom in">＋</button><button className="pill" onClick={() => setZoom(1)}>Reset</button>
      {canOrig ? <button className="pill" aria-pressed={showOrig} onClick={() => setShowOrig(!showOrig)}>{showOrig ? 'Showing original' : 'View original'}</button> : <span className="text-xs">{a.original_retained ? 'This is the original file' : 'Original not kept: this is the optimized copy'}</span>}
      <button className="pill" onClick={onClose} autoFocus>Close ✕</button></div>
    <div className="flex-1 overflow-auto mt-2 grid place-items-center" onClick={e => e.target === e.currentTarget && onClose()}>
      {err ? <p className="danger">{err}</p> : !url ? <p className="text-white">Loading…</p> : a.kind === 'document' ? <iframe title={a.filename} src={url} style={{ width: '90vw', height: '80vh', background: '#fff' }} /> : <img src={url} alt={a.alt_text || a.caption || a.filename} style={{ width: zoom === 1 ? undefined : `${zoom * 100}%`, maxWidth: zoom === 1 ? '100%' : 'none', maxHeight: zoom === 1 ? '100%' : 'none' }} />}</div>
    {(a.caption || a.description) && <p className="text-white text-sm mt-2 max-h-24 overflow-auto">{a.caption} {a.description}</p>}</div>
}
