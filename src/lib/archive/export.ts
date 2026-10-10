import { sha256Hex } from '../attachments/sniff'
import { writeZip, type ZipEntry, type ZipStat } from './zip'
import { ENTITY_TABLES, FORMAT_ID, IMPORT_MD, SCHEMA_VERSION, TABLES, TABLE_ORDER, schemaMd, type Manifest, type Row, type TableName, type Variant } from './schema'
export interface ExportSource { fetchAll(table: TableName): Promise<Row[]>; download(path: string): Promise<Uint8Array | null> }
export interface ExportOptions { contents: 'compact' | 'readable' | 'both'; scope: { all: boolean; moduleIds: string[] }; include: { originals: boolean; optimized: boolean; thumbnails: boolean }; now?: Date }
export interface ExportReport {
  zipBytes: number; uncompressedBytes: number; textRawBytes: number; textStoredBytes: number; imageBytes: number
  counts: Record<string, number>; files: number; missing: Manifest['missing_files']; droppedRelations: number; contents: ExportOptions['contents']
}
const te = new TextEncoder()
const str = (v: unknown) => (typeof v === 'string' ? v : v == null ? '' : String(v))
export const slug = (s: string) => (s.normalize('NFKC').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-').replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^[-.]+|[-.]+$/g, '').slice(0, 60)) || 'untitled'
const titleOf = (t: TableName, r: Row) => str(r.title ?? r.question ?? r.day) || '(untitled)'
const extOf = (p: string) => p.slice(p.lastIndexOf('.') + 1).toLowerCase().replace(/[^a-z0-9]/g, '') || 'bin'
const yaml = (o: Record<string, unknown>) => '---\n' + Object.entries(o).filter(([, v]) => v != null && v !== '' && !(Array.isArray(v) && !v.length)).map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join('\n') + '\n---\n'

export function selectScope(data: Record<TableName, Row[]>, scope: ExportOptions['scope']): { data: Record<TableName, Row[]>; droppedRelations: number } {
  const live = { ...data, attachments: data.attachments.filter(a => a.status !== 'pending_deletion') }
  if (scope.all) return { data: live, droppedRelations: 0 }
  const mods = new Set(scope.moduleIds)
  const records = live.records.filter(r => mods.has(str(r.id)) || mods.has(str(r.module_id)))
  const ids = new Set(records.map(r => str(r.id)))
  const relations = live.relations.filter(r => r.from_type === 'records' && r.to_type === 'records' && ids.has(str(r.from_id)) && ids.has(str(r.to_id)))
  const empty = Object.fromEntries(TABLE_ORDER.map(t => [t, [] as Row[]])) as Record<TableName, Row[]>
  return { data: { ...empty, records, attachments: live.attachments.filter(a => a.parent_type === 'records' && ids.has(str(a.parent_id))), relations }, droppedRelations: live.relations.length - relations.length }
}

export async function buildArchive(src: ExportSource, opts: ExportOptions): Promise<{ zip: Uint8Array; manifest: Manifest; report: ExportReport }> {
  const all = {} as Record<TableName, Row[]>; for (const t of TABLE_ORDER) all[t] = await src.fetchAll(t)
  const { data, droppedRelations } = selectScope(all, opts.scope)
  const entries: ZipEntry[] = []; const files: Manifest['files'] = []; const missing: Manifest['missing_files'] = []
  const fileOf = new Map<string, { variant: Variant; path: string }[]>()
  // ---- attachment files ----
  for (const a of data.attachments) {
    const id = str(a.id); const want: { variant: Variant; from: string; mime: string; ext: string }[] = []
    const o = str(a.original_path), d = str(a.display_path), t = str(a.thumb_path)
    if (opts.include.originals && o) want.push({ variant: 'original', from: o, mime: str(a.mime), ext: extOf(o) })
    if (opts.include.optimized && d && !(d === o && opts.include.originals)) want.push({ variant: 'display', from: d, mime: str(a.display_mime) || str(a.mime), ext: extOf(d) })
    if (opts.include.thumbnails && t) want.push({ variant: 'thumb', from: t, mime: 'image/webp', ext: extOf(t) })
    for (const w of want) {
      const bytes = await src.download(w.from)
      if (!bytes) { missing.push({ attachment_id: id, variant: w.variant, reason: 'file not found in storage' }); continue }
      const path = `files/${id}/${w.variant}.${w.ext}`
      entries.push({ path, data: bytes, compress: false })   // images/PDFs are already compressed; deflating them wastes time for ~0 gain
      files.push({ path, attachment_id: id, variant: w.variant, mime: w.mime, bytes: bytes.length, sha256: await sha256Hex(bytes) })
      fileOf.set(id, [...(fileOf.get(id) ?? []), { variant: w.variant, path }])
    }
  }
  const text: ZipEntry[] = []
  const manifestTables: Manifest['tables'] = {}; const counts: Record<string, number> = {}
  for (const t of TABLE_ORDER) counts[t] = data[t].length
  // ---- compact: columnar JSON Lines ----
  if (opts.contents !== 'readable') for (const t of TABLE_ORDER) {
    if (!data[t].length) continue
    const cols = TABLES[t].cols
    const lines = [JSON.stringify({ table: t, columns: cols }), ...data[t].map(r => JSON.stringify(cols.map(c => r[c] ?? null)))]
    const bytes = te.encode(lines.join('\n') + '\n'); const file = `data/${t}.jsonl`
    text.push({ path: file, data: bytes }); manifestTables[t] = { file, rows: data[t].length, sha256: await sha256Hex(bytes) }
  }
  // ---- readable: Markdown by module / kind / date ----
  if (opts.contents !== 'compact') text.push(...readable(data, fileOf))
  const manifest: Manifest = { format: FORMAT_ID, schema_version: SCHEMA_VERSION, created_at: (opts.now ?? new Date()).toISOString(), encoding: 'utf-8', app: 'project-mission-control',
    compression: 'zip: DEFLATE for text, stored (no recompression) for images and PDFs', contents: opts.contents,
    scope: { all: opts.scope.all, module_ids: opts.scope.moduleIds }, include_files: { originals: opts.include.originals, optimized: opts.include.optimized, thumbnails: opts.include.thumbnails },
    tables: manifestTables, files, missing_files: missing, counts }
  text.unshift({ path: 'manifest.json', data: te.encode(JSON.stringify(manifest, null, 2)) }, { path: 'IMPORT.md', data: te.encode(IMPORT_MD) }, { path: 'SCHEMA.md', data: te.encode(schemaMd()) })
  const stats: ZipStat[] = []
  const zip = await writeZip([...text, ...entries], opts.now ?? new Date(), stats)
  const isText = (p: string) => !p.startsWith('files/')
  const sum = (f: (s: ZipStat) => number, pred: (p: string) => boolean) => stats.filter(s => pred(s.path)).reduce((n, s) => n + f(s), 0)
  return { zip, manifest, report: { zipBytes: zip.length, uncompressedBytes: sum(s => s.raw, () => true), textRawBytes: sum(s => s.raw, isText), textStoredBytes: sum(s => s.stored, isText), imageBytes: sum(s => s.raw, p => !isText(p)),
    counts, files: files.length, missing, droppedRelations, contents: opts.contents } }
}

function readable(data: Record<TableName, Row[]>, fileOf: Map<string, { variant: Variant; path: string }[]>): ZipEntry[] {
  const out: ZipEntry[] = []; const title = new Map<string, string>()
  for (const t of ENTITY_TABLES) for (const r of data[t]) title.set(`${t}:${str(r.id)}`, titleOf(t, r))
  const mods = new Map(data.records.filter(r => r.kind === 'module').map(r => [str(r.id), r]))
  const relsOf = (t: string, id: string) => data.relations.flatMap(r => r.from_type === t && r.from_id === id ? [`- ${str(r.label)} → ${title.get(`${r.to_type}:${r.to_id}`) ?? '(not in this export)'} (${r.to_type}/${str(r.to_id)})`] : r.to_type === t && r.to_id === id ? [`- ← ${title.get(`${r.from_type}:${r.from_id}`) ?? '(not in this export)'} ${str(r.label)} (${r.from_type}/${str(r.from_id)})`] : [])
  const attsMd = (t: string, id: string, rel: string) => data.attachments.filter(a => a.parent_type === t && a.parent_id === id).sort((a, b) => Number(a.position) - Number(b.position)).map(a => {
    const f = fileOf.get(str(a.id)) ?? []; const pick = f.find(x => x.variant === 'display') ?? f.find(x => x.variant === 'original') ?? f.find(x => x.variant === 'thumb')
    const link = pick ? `${rel}${pick.path}` : null; const alt = str(a.alt_text) || str(a.filename)
    const lines = [`### ${str(a.filename)}${a.kind === 'image' && link ? `\n\n![${alt}](${link})` : link ? `\n\n[${str(a.filename)}](${link})` : '\n\n_(file not included in this export)_'}`]
    lines.push(`Attachment id: ${str(a.id)} · ${str(a.mime)} · ${a.byte_size} bytes · sha256 ${str(a.checksum).slice(0, 12)}…${f.length ? ' · files: ' + f.map(x => x.variant).join(', ') : ''}`)
    if (a.caption) lines.push(`Caption: ${str(a.caption)}`)
    if (a.description) lines.push(`Description (written by you): ${str(a.description)}`)
    if (a.extracted_text) lines.push(`Extracted text (${a.extracted_source === 'ocr' ? 'machine-extracted by OCR' + (a.extracted_edited ? ', then edited by you' : ', unverified') : 'entered manually'}):\n\n> ${str(a.extracted_text).replace(/\n/g, '\n> ')}`)
    return lines.join('\n\n')
  })
  const section = (h: string, parts: string[]) => parts.length ? `\n## ${h}\n\n${parts.join('\n\n')}\n` : ''
  const index: string[] = ['# Academic archive (readable)', '', `Generated ${new Date().toISOString()}. Layout: readable/<module>/<record type>/<date>-<title>-<id>.md`, '']
  for (const r of data.records) {
    const id = str(r.id), mod = r.kind === 'module' ? r : mods.get(str(r.module_id)); const folder = mod ? slug(str(mod.title)) : '_unassigned'
    const path = `readable/${folder}/${slug(str(r.kind))}/${str(r.occurred_on) || 'undated'}-${slug(str(r.title))}-${id.slice(0, 8)}.md`
    const meta = r.meta && typeof r.meta === 'object' ? r.meta as Record<string, unknown> : {}
    const md = yaml({ id, kind: r.kind, title: r.title, module: mod ? { id: mod.id, title: mod.title } : undefined, date: r.occurred_on, tags: r.tags, archived: r.archived_at, created: r.created_at, updated: r.updated_at, meta: Object.keys(meta).length ? meta : undefined }) +
      `\n# ${str(r.title)}\n\n${str(r.body)}\n` + section('Attachments', attsMd('records', id, '../'.repeat(path.split('/').length - 1))) + section('Related', relsOf('records', id))
    out.push({ path, data: te.encode(md) }); index.push(`- [${str(r.title)}](${path.replace('readable/', '')}) — ${str(r.kind)}`)
  }
  const other = (file: string, h: string, t: TableName, line: (r: Row) => string) => {
    if (!data[t].length) return
    const rel = '../../'
    const body = data[t].map(r => `${line(r)}${section('Attachments', attsMd(t, str(r.id), rel)).replace(/^\n## /, '\n#### ')}${relsOf(t, str(r.id)).length ? '\n  Related:\n' + relsOf(t, str(r.id)).map(x => '  ' + x).join('\n') : ''}`)
    out.push({ path: `readable/_other/${file}.md`, data: te.encode(`# ${h}\n\n${body.join('\n\n')}\n`) }); index.push(`- [${h}](_other/${file}.md)`)
  }
  other('tasks', 'Tasks and subtasks', 'tasks', r => `- [${r.status === 'done' ? 'x' : ' '}] ${str(r.title)} (${str(r.tier)}${r.due ? ', due ' + str(r.due) : ''}${r.parent_id ? ', subtask of ' + (title.get('tasks:' + str(r.parent_id)) ?? str(r.parent_id)) : ''}) <!-- ${str(r.id)} -->${r.notes ? '\n  ' + str(r.notes) : ''}`)
  other('deadlines', 'Deadlines and events', 'events', r => `- ${str(r.date)} · ${str(r.kind)} · ${r.done ? 'done' : 'open'} · ${str(r.title)} <!-- ${str(r.id)} -->`)
  other('decisions', 'Decisions', 'decisions', r => `### ${str(r.question)}\n\nChosen: ${str(r.chosen)}\n\nReason: ${str(r.reason)}\n\nAlternatives: ${str(r.alternatives)}\n\nDecided: ${str(r.decided_on)} · confidence ${str(r.confidence)} <!-- ${str(r.id)} -->`)
  other('blockers', 'Blockers', 'blockers', r => `- [${r.status === 'resolved' ? 'x' : ' '}] ${str(r.title)} (${str(r.severity)}) next: ${str(r.next_action)} <!-- ${str(r.id)} -->`)
  other('projects', 'Projects', 'projects', r => `### ${str(r.title)}\n\n${str(r.objective)} <!-- ${str(r.id)} -->`)
  other('daily-records', 'Daily records', 'daily_records', r => `### ${str(r.day)}\n\nMission: ${str(r.mission)}\n\nWin: ${str(r.biggest_win)}\n\nChallenge: ${str(r.biggest_challenge)}\n\nLearned: ${str(r.learned)} <!-- ${str(r.id)} -->`)
  out.unshift({ path: 'readable/README.md', data: te.encode(index.join('\n') + '\n') })
  return out
}
