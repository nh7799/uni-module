import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useUserId } from '../lib/session'
import { fmtBytes } from '../lib/attachments/instance'
import { buildArchive, type ExportReport } from '../lib/archive/export'
import { restoreArchive, validateArchive, type RestoreReport, type ValidationResult } from '../lib/archive/import'
import { exportSource, importPort, logEvent } from '../lib/archive/supabaseArchive'
import { readZip } from '../lib/archive/zip'
import { Err, Title } from '../components/ui'
type Contents = 'compact' | 'readable' | 'both'
export default function ExportPage() {
  const userId = useUserId(); const [contents, setContents] = useState<Contents>('both'); const [all, setAll] = useState(true); const [mods, setMods] = useState<{ id: string; title: string }[]>([]); const [pick, setPick] = useState<string[]>([])
  const [inc, setInc] = useState({ originals: false, optimized: true, thumbnails: false }); const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null)
  const [result, setResult] = useState<{ report: ExportReport; url: string; name: string } | null>(null)
  useEffect(() => { supabase.from('records').select('id,title').eq('kind', 'module').order('title').then(({ data }) => setMods((data ?? []) as { id: string; title: string }[])) }, [])
  useEffect(() => () => { if (result) URL.revokeObjectURL(result.url) }, [result])
  const run = async () => {
    setBusy(true); setErr(null); setResult(null)
    try {
      if (!all && !pick.length) throw new Error('Choose at least one module, or export everything.')
      const { zip, report } = await buildArchive(exportSource, { contents, scope: { all, moduleIds: pick }, include: inc })
      const name = `academic-archive-${new Date().toISOString().slice(0, 10)}-${contents}.zip`; const url = URL.createObjectURL(new Blob([zip as BlobPart], { type: 'application/zip' }))
      const logErr = await logEvent('export', { format: contents, ok: true, bytes: report.zipBytes, uncompressed_bytes: report.uncompressedBytes, record_count: Object.values(report.counts).reduce((a, b) => a + b, 0), detail: { counts: report.counts, files: report.files, missing: report.missing.length } })
      if (logErr) setErr('The archive was built, but recording it in the export log failed: ' + logErr)
      setResult({ report, url, name })
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); await logEvent('export', { format: contents, ok: false, detail: { error: String(e) } }) }
    setBusy(false)
  }
  const r = result?.report
  return <div><Title sub="Keep a readable, searchable copy of your academic work that does not depend on this app.">Export & recovery</Title><Err msg={err} />
    <section className="card mb-6"><h2 className="font-bold mb-3">Create an archive</h2>
      <fieldset className="mb-3"><legend className="text-sm text-slate-400 font-medium">Format</legend><div className="flex gap-2 flex-wrap">{([['both', 'Readable + compact (recommended)'], ['readable', 'Readable Markdown only'], ['compact', 'Compact JSON Lines only (restorable)']] as [Contents, string][]).map(([v, l]) => <button key={v} className="pill" aria-pressed={contents === v} onClick={() => setContents(v)}>{l}</button>)}</div></fieldset>
      <fieldset className="mb-3"><legend className="text-sm text-slate-400 font-medium">What to include</legend><div className="flex gap-2 flex-wrap"><button className="pill" aria-pressed={all} onClick={() => setAll(true)}>Everything</button><button className="pill" aria-pressed={!all} onClick={() => setAll(false)}>Selected modules only</button></div>
        {!all && <ul className="mt-2 grid sm:grid-cols-2 gap-1">{mods.map(m => <li key={m.id}><label><input type="checkbox" checked={pick.includes(m.id)} onChange={e => setPick(e.target.checked ? [...pick, m.id] : pick.filter(x => x !== m.id))} /> {m.title}</label></li>)}{!mods.length && <li className="text-slate-400">No modules yet.</li>}</ul>}
        {!all && <p className="text-xs text-slate-500 mt-1">A module export contains the module, its records, their attachments and links between those records. Tasks, deadlines and other items are only in a full export.</p>}</fieldset>
      <fieldset className="mb-3"><legend className="text-sm text-slate-400 font-medium">Image files</legend><div className="flex gap-3 flex-wrap">{([['originals', 'Originals (when kept)'], ['optimized', 'Optimized copies'], ['thumbnails', 'Thumbnails']] as const).map(([k, l]) => <label key={k}><input type="checkbox" checked={inc[k]} onChange={e => setInc({ ...inc, [k]: e.target.checked })} /> {l}</label>)}</div>
        <p className="text-xs text-slate-500 mt-1">Leave all unticked for a text-only archive (captions, descriptions and extracted text are always included). Images are not recompressed in the archive; JPEG/WebP/PNG are already compressed, so only the text part shrinks.</p></fieldset>
      <button className="btn" onClick={run} disabled={busy || !userId}>{busy ? 'Building…' : 'Build archive'}</button></section>
    {r && result && <section className="card mb-6 pop" role="status"><h3 className="font-bold">Archive ready ✓</h3>
      <ul className="list-disc ml-6 my-2"><li>Final size (measured): <b>{fmtBytes(r.zipBytes)}</b>; contents before ZIP: {fmtBytes(r.uncompressedBytes)}</li>
        <li>Text: {fmtBytes(r.textRawBytes)} → {fmtBytes(r.textStoredBytes)} inside the ZIP{r.textRawBytes ? ` (${Math.round((1 - r.textStoredBytes / r.textRawBytes) * 100)}% smaller)` : ''}</li>
        <li>Images: {r.files} file(s), {fmtBytes(r.imageBytes)}, stored as-is</li>
        <li>Records: {Object.entries(r.counts).filter(([, n]) => n).map(([t, n]) => `${n} ${t.replace('_', ' ')}`).join(', ') || 'none'}</li>
        {r.droppedRelations > 0 && <li>{r.droppedRelations} link(s) to items outside this selection were not included.</li>}</ul>
      {r.missing.length > 0 && <p className="warn mb-2">{r.missing.length} image file(s) could not be read from storage and are missing from this archive. Check the Health page.</p>}
      <a className="btn inline-block" href={result.url} download={result.name}>⬇ Download {result.name}</a></section>}
    <ImportSection userId={userId} />
    <section className="card"><h2 className="font-bold mb-2">Backup & recovery guide</h2>
      <ol className="list-decimal ml-6 space-y-1"><li><b>Regular archive:</b> export "Readable + compact" with optimized (and originals if you need them) at least monthly and before deleting anything big. Store it somewhere other than this app.</li>
        <li><b>Check it:</b> use "Verify" below on the downloaded file. This proves the archive is intact and internally consistent; it does not test your Supabase backups.</li>
        <li><b>Database backups:</b> Supabase creates its own backups depending on your plan (see Dashboard → Database → Backups). This app does not check them.</li>
        <li><b>Files:</b> images live in the private Supabase Storage bucket <code>attachments</code>; the Health page can find missing files and orphaned uploads.</li>
        <li><b>Restore:</b> sign in (same or a new account), import the compact archive. Records that already exist are skipped, so an interrupted restore can simply be run again.</li></ol></section></div>
}
function ImportSection({ userId }: { userId: string | null }) {
  const [v, setV] = useState<ValidationResult | null>(null); const [name, setName] = useState(''); const [busy, setBusy] = useState(false); const [prog, setProg] = useState(''); const [rep, setRep] = useState<RestoreReport | null>(null); const [err, setErr] = useState<string | null>(null)
  const onFile = async (f: File) => {
    setBusy(true); setErr(null); setRep(null); setV(null); setName(f.name); setProg('Reading and checking every file…')
    try { const entries = await readZip(new Uint8Array(await f.arrayBuffer())); const res = await validateArchive(entries); setV(res)
      await logEvent('verify', { format: res.manifest?.contents, ok: res.ok, bytes: f.size, record_count: Object.values(res.summary).reduce((a, b) => a + b, 0), detail: { file: f.name, errors: res.errors.slice(0, 20), warnings: res.warnings.length, schema_version: res.manifest?.schema_version } }) }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); await logEvent('verify', { ok: false, detail: { file: f.name, error: String(e) } }) }
    setBusy(false); setProg('')
  }
  const restore = async () => {
    if (!v || !userId || !confirm('Restore this archive into your account? Existing records with the same ids are left untouched; everything else is added.')) return
    setBusy(true); setErr(null)
    try { const r = await restoreArchive(v, importPort(userId), setProg); setRep(r); await logEvent('import', { ok: r.complete, record_count: Object.values(r.inserted).reduce((a, b) => a + b, 0), detail: { inserted: r.inserted, skipped: r.skippedExisting, files: r.filesUploaded, failures: r.failures.slice(0, 20) } }) }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)) }
    setBusy(false); setProg('')
  }
  const n = useMemo(() => v ? Object.entries(v.summary).filter(([, c]) => c).map(([t, c]) => `${c} ${t.replace('_', ' ')}`).join(', ') : '', [v])
  return <section className="card mb-6"><h2 className="font-bold mb-2">Verify or restore an archive</h2>
    <p className="text-sm text-slate-400 mb-2">Choosing a file only checks it (manifest, schema version, SHA-256 of every file, safe paths, unique ids, all links resolve). Nothing changes until you press Restore.</p>
    <input type="file" accept=".zip,application/zip" disabled={busy} onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) onFile(f) }} aria-label="Choose archive file" />
    {prog && <p className="mt-2 text-slate-400" role="status">{prog}</p>}<Err msg={err} />
    {v && <div className="mt-3" role="status"><p className={v.ok ? 'font-bold' : 'danger'}>{v.ok ? `✓ ${name} is valid` : `✗ ${name} failed validation`}{v.manifest ? ` (schema ${v.manifest.schema_version}, created ${v.manifest.created_at.slice(0, 10)})` : ''}</p>
      {v.ok && <p>Contains: {n || 'no records'}; {v.files.size} image file(s).</p>}
      {v.errors.length > 0 && <ul className="list-disc ml-6 mt-1">{v.errors.slice(0, 15).map(e => <li key={e}>{e}</li>)}{v.errors.length > 15 && <li>…and {v.errors.length - 15} more</li>}</ul>}
      {v.warnings.length > 0 && <ul className="list-disc ml-6 mt-1 text-slate-400">{v.warnings.map(w => <li key={w}>{w}</li>)}</ul>}
      {v.ok && !rep && <button className="btn mt-3" disabled={busy || !userId} onClick={restore}>Restore into my account</button>}</div>}
    {rep && <div className="mt-3" role="status"><p className={rep.complete ? 'font-bold' : 'danger'}>{rep.complete ? '✓ Restore complete' : '✗ Restore stopped early'}</p>
      <ul className="list-disc ml-6">{Object.entries(rep.inserted).map(([t, c]) => <li key={t}>{t}: {c} added{rep.skippedExisting[t] ? `, ${rep.skippedExisting[t]} already existed (skipped)` : ''}</li>)}<li>{rep.filesUploaded} file(s) uploaded</li></ul>
      {rep.failures.map(f => <p key={f} className="danger mt-1">{f}</p>)}</div>}</section>
}
