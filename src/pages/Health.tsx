import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useUserId } from '../lib/session'
import { loadConfig } from '../lib/attachments/config'
import { fmtBytes, makeService } from '../lib/attachments/instance'
import { dbPort, maintPort, storagePort } from '../lib/attachments/supabasePorts'
import { reconcile, repair, type ReconcileReport, type RepairResult } from '../lib/attachments/maintenance'
import type { AttachmentRow } from '../lib/attachments/types'
import { Err, Title } from '../components/ui'

type Metric<T> = { ok: true; value: T } | { ok: false; error: string }
const safe = async <T,>(f: () => PromiseLike<T>): Promise<Metric<T>> => { try { return { ok: true, value: await f() } } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) } } }
const count = async (table: string, f?: (q: any) => any) => { let q: any = supabase.from(table).select('id', { count: 'exact', head: true }); if (f) q = f(q); const { count: n, error } = await q; if (error) throw new Error(error.message); return n ?? 0 }
export const parentLink = (t: string, id: string) => t === 'records' ? `/library?open=${id}` : t === 'tasks' ? '/tasks' : t === 'events' ? '/timeline' : t === 'decisions' ? '/decisions' : t === 'blockers' ? '/blockers' : '/projects'
interface Snapshot { modules: Metric<number>; records: Metric<number>; notes: Metric<number>; attachments: Metric<number>; bytes: Metric<number | null>; failed: Metric<AttachmentRow[]>; unfinished: Metric<AttachmentRow[]>; pendingDel: Metric<number>; openTasks: Metric<number>; recent: Metric<{ id: string; title: string; kind: string; updated_at: string }[]>; lastExport: Metric<{ created_at: string; ok: boolean; bytes: number | null } | null>; lastVerify: Metric<{ created_at: string; ok: boolean } | null>; db: Metric<number>; storage: Metric<number> }

export default function Health() {
  const userId = useUserId(); const [s, setS] = useState<Snapshot | null>(null); const [rep, setRep] = useState<ReconcileReport | null>(null); const [busy, setBusy] = useState(''); const [err, setErr] = useState<string | null>(null); const [fix, setFix] = useState<RepairResult | null>(null)
  const cfg = useMemo(loadConfig, [])
  const load = useCallback(async () => {
    const t0 = performance.now()
    const [modules, records, notes, attachments, rows, failed, unfinished, pendingDel, openTasks, recent, lastExport, lastVerify] = await Promise.all([
      safe(() => count('records', q => q.eq('kind', 'module').is('archived_at', null))), safe(() => count('records', q => q.is('archived_at', null))), safe(() => count('records', q => q.in('kind', ['note', 'lecture', 'programming_note']).is('archived_at', null))),
      safe(() => count('attachments', q => q.neq('status', 'pending_deletion'))),
      safe(async () => { const { data, error } = await supabase.from('attachments').select('original_bytes,display_bytes,thumb_bytes').neq('status', 'pending_deletion'); if (error) throw new Error(error.message); return (data ?? []).reduce((a, r) => a + (r.original_bytes ?? 0) + (r.display_bytes ?? 0) + (r.thumb_bytes ?? 0), 0) }),
      safe(async () => { const { data, error } = await supabase.from('attachments').select('*').eq('status', 'failed').order('updated_at', { ascending: false }).limit(50); if (error) throw new Error(error.message); return (data ?? []) as AttachmentRow[] }),
      safe(async () => { const { data, error } = await supabase.from('attachments').select('*').in('status', ['uploading', 'processing', 'saved', 'stored']).order('updated_at').limit(50); if (error) throw new Error(error.message); return (data ?? []) as AttachmentRow[] }),
      safe(() => count('attachments', q => q.eq('status', 'pending_deletion'))), safe(() => count('tasks', q => q.eq('status', 'todo'))),
      safe(async () => { const { data, error } = await supabase.from('records').select('id,title,kind,updated_at').order('updated_at', { ascending: false }).limit(8); if (error) throw new Error(error.message); return data ?? [] }),
      safe(async () => { const { data, error } = await supabase.from('export_log').select('created_at,ok,bytes').eq('kind', 'export').eq('ok', true).order('created_at', { ascending: false }).limit(1); if (error) throw new Error(error.message); return data?.[0] ?? null }),
      safe(async () => { const { data, error } = await supabase.from('export_log').select('created_at,ok').eq('kind', 'verify').eq('ok', true).order('created_at', { ascending: false }).limit(1); if (error) throw new Error(error.message); return data?.[0] ?? null })])
    const db: Metric<number> = records.ok ? { ok: true, value: Math.round(performance.now() - t0) } : { ok: false, error: records.error }
    const storage = await safe(async () => { const t = performance.now(); const { error } = await supabase.storage.from('attachments').list(userId ?? '', { limit: 1 }); if (error) throw new Error(error.message); return Math.round(performance.now() - t) })
    // Storage usage is the sum of byte sizes recorded in metadata (not a bucket-level measurement).
    setS({ modules, records, notes, attachments, bytes: rows, failed, unfinished, pendingDel, openTasks, recent, lastExport, lastVerify, db, storage })
  }, [userId])
  useEffect(() => { if (userId) load() }, [userId, load])
  const scan = async (deep: boolean) => { if (!userId) return; setBusy(deep ? 'deep' : 'quick'); setErr(null); setFix(null); try { setRep(await reconcile(maintPort(userId), { deep })) } catch (e) { setErr(e instanceof Error ? e.message : String(e)) } setBusy('') }
  const doRepair = async () => {
    if (!userId || !rep) return; const svc = makeService(userId, cfg)
    if (!confirm(`Apply safe repairs?\n\n• ${new Set(rep.missingFiles.map(f => f.id)).size} record(s) with missing files will be marked failed (nothing is deleted)\n• ${rep.orphanFolders.length} orphaned storage folder(s) will be deleted\n• ${rep.stuck.length} interrupted upload(s) will be marked failed and their partial files removed\n• ${rep.pending.length} attachment(s) pending deletion will have their files removed permanently`)) return
    setBusy('repair'); setErr(null)
    try { setFix(await repair(maintPort(userId), dbPort, storagePort, rep, r => svc.purgeOne(r))); await scan(rep.deep); await load() } catch (e) { setErr(e instanceof Error ? e.message : String(e)) }
    setBusy('')
  }
  const val = (m: Metric<any> | undefined, f: (v: any) => string = v => String(v)) => !m ? '…' : m.ok ? f(m.value) : <span className="danger" title={m.error}>unavailable</span>
  const Card = ({ label, v }: { label: string; v: React.ReactNode }) => <div className="card"><div className="text-sm text-slate-400">{label}</div><div className="text-2xl font-bold">{v}</div></div>
  const Row = ({ r }: { r: AttachmentRow }) => <li className="py-1"><Link className="underline" to={parentLink(r.parent_type, r.parent_id)}>{r.filename}</Link> <span className="text-slate-400">({r.status}{r.error ? ': ' + r.error : ''})</span></li>
  const failed = s?.failed.ok ? s.failed.value : [], unfinished = s?.unfinished.ok ? s.unfinished.value : []
  const hasIssues = failed.length + unfinished.length > 0 || (rep && (rep.missingFiles.length + rep.orphanFolders.length + rep.stuck.length + rep.pending.length) > 0)
  return <div><Title sub="The state of your academic data. Anything that cannot be measured is shown as unavailable rather than guessed.">System health</Title><Err msg={err} />
    <div className="grid gap-3 grid-cols-2 sm:grid-cols-4 mb-6">
      <Card label="Modules" v={val(s?.modules)} /><Card label="Academic records" v={val(s?.records)} /><Card label="Notes & lectures" v={val(s?.notes)} /><Card label="Attachments" v={val(s?.attachments)} />
      <Card label="Storage used (from metadata)" v={val(s?.bytes, v => fmtBytes(v))} /><Card label="Failed processing" v={val(s?.failed, v => String(v.length))} /><Card label="Incomplete uploads" v={val(s?.unfinished, v => String(v.length))} /><Card label="Pending operations" v={val(s?.pendingDel, n => `${n} deletion${n === 1 ? '' : 's'}`)} /></div>
    <section className="card mb-6"><h2 className="font-bold mb-2">Connectivity & configuration</h2><ul className="space-y-1">
      <li>Database: {s ? s.db.ok ? `✓ reachable (${s.db.value} ms)` : <span className="danger">✗ {s.db.error}</span> : '…'}</li>
      <li>File storage: {s ? s.storage.ok ? `✓ reachable (${s.storage.value} ms)` : <span className="danger">✗ {s.storage.error}</span> : '…'}</li>
      <li>Signed in: {userId ? '✓ yes' : '…'}</li>
      <li>Image settings: originals {cfg.retainOriginals ? 'kept' : 'not kept (optimized copies only)'}, max {cfg.maxDisplayDim}px, upload limit {fmtBytes(cfg.maxUploadBytes)}, settings stored on this device</li>
      <li>OCR: loaded on demand from a CDN when you press “Extract text”; it is not checked here. Manual descriptions always work.</li>
      <li>Open tasks: {val(s?.openTasks)}</li></ul></section>
    <section className="card mb-6"><h2 className="font-bold mb-2">Backups & exports</h2><ul className="space-y-1">
      <li>Last successful export: {s?.lastExport.ok ? s.lastExport.value ? `${new Date(s.lastExport.value.created_at).toLocaleString()} (${fmtBytes(s.lastExport.value.bytes)})` : <span className="warn">never — <Link className="underline" to="/export">create one</Link></span> : val(s?.lastExport)}</li>
      <li>Last archive verification: {s?.lastVerify.ok ? s.lastVerify.value ? new Date(s.lastVerify.value.created_at).toLocaleString() : 'never' : val(s?.lastVerify)}</li>
      <li>Database backups: <b>not verified by this app.</b> Check Supabase → Database → Backups. See <Link className="underline" to="/export">Export & recovery</Link> for the procedure.</li></ul></section>
    <section className="card mb-6"><h2 className="font-bold mb-2">Attachment integrity</h2>
      <div className="flex gap-2 flex-wrap mb-3"><button className="btn" disabled={!!busy} onClick={() => scan(false)}>{busy === 'quick' ? 'Scanning…' : 'Quick scan'}</button><button className="btn" disabled={!!busy} onClick={() => scan(true)}>{busy === 'deep' ? 'Checking every file…' : 'Deep scan (verify files exist)'}</button><button className="pill" disabled={!!busy} onClick={load}>↻ Refresh numbers</button></div>
      {rep && <div role="status"><p className="text-sm text-slate-400">Scanned {rep.totalRows} attachment(s) at {new Date(rep.checkedAt).toLocaleTimeString()} ({rep.deep ? 'deep' : 'quick'}).</p>
        <ul className="list-disc ml-6 my-2"><li>Missing files: {rep.deep ? rep.missingFiles.length : 'not checked in a quick scan'}</li><li>Orphaned storage folders: {rep.orphanFolders.length}</li><li>Stuck uploads (over 1 hour): {rep.stuck.length}</li><li>Failed: {rep.failed.length}</li><li>Pending deletion: {rep.pending.length}</li></ul>
        {rep.missingFiles.map(m => <p key={m.path} className="danger text-sm">{m.filename} ({m.variant}) is missing from storage.</p>)}
        {(rep.missingFiles.length + rep.orphanFolders.length + rep.stuck.length + rep.pending.length) > 0 ? <button className="btn" disabled={!!busy} onClick={doRepair}>{busy === 'repair' ? 'Repairing…' : 'Apply safe repairs…'}</button> : <p className="font-bold">✓ Nothing to repair.</p>}</div>}
      {fix && <div className="mt-3" role="status"><p className="font-bold">Repair finished</p><ul className="list-disc ml-6"><li>{fix.markedMissing} marked failed (missing files)</li><li>{fix.orphansRemoved} orphan folder(s) removed</li><li>{fix.stuckFailed} interrupted upload(s) cleared</li><li>{fix.purged} pending deletion(s) completed</li></ul>{fix.errors.map(e => <p key={e} className="danger text-sm">{e}</p>)}</div>}</section>
    {hasIssues ? <section className="card mb-6"><h2 className="font-bold mb-2">Needs attention</h2>{failed.length > 0 && <><h3 className="font-semibold">Failed ({failed.length}) — open the record and use Retry or re-attach</h3><ul>{failed.map(r => <Row key={r.id} r={r} />)}</ul></>}{unfinished.length > 0 && <><h3 className="font-semibold mt-3">Unfinished ({unfinished.length})</h3><ul>{unfinished.map(r => <Row key={r.id} r={r} />)}</ul></>}</section> : s && <p className="mb-6 font-bold">✓ No failed or incomplete attachments.</p>}
    <section className="card"><h2 className="font-bold mb-2">Recently modified records</h2>{s?.recent.ok ? s.recent.value.length ? <ul>{s.recent.value.map(r => <li key={r.id} className="py-1"><Link className="underline" to={`/library?open=${r.id}`}>{r.title}</Link> <span className="text-slate-400">{r.kind.replace('_', ' ')} · {new Date(r.updated_at).toLocaleString()}</span></li>)}</ul> : <p>No records yet.</p> : val(s?.recent)}</section></div>
}
