export const SCHEMA_VERSION = '1.0'
export const FORMAT_ID = 'mission-control-archive'
export const SUPPORTED_MAJOR = 1
export type TableName = 'records' | 'tasks' | 'events' | 'decisions' | 'blockers' | 'projects' | 'daily_records' | 'attachments' | 'relations'
/** Exported columns per table, in file order. user_id is deliberately never exported (archives are portable between accounts). */
export const TABLES: Record<TableName, { cols: string[]; required: string[] }> = {
  records: { cols: ['id', 'kind', 'title', 'body', 'meta', 'occurred_on', 'module_id', 'tags', 'archived_at', 'created_at', 'updated_at'], required: ['id', 'kind', 'title'] },
  tasks: { cols: ['id', 'title', 'tier', 'status', 'due', 'parent_id', 'notes', 'created_at'], required: ['id', 'title'] },
  events: { cols: ['id', 'title', 'date', 'kind', 'done', 'created_at'], required: ['id', 'title', 'date', 'kind'] },
  decisions: { cols: ['id', 'question', 'chosen', 'reason', 'alternatives', 'confidence', 'decided_on', 'created_at'], required: ['id', 'question'] },
  blockers: { cols: ['id', 'title', 'severity', 'status', 'next_action', 'created_at'], required: ['id', 'title'] },
  projects: { cols: ['id', 'title', 'objective', 'created_at'], required: ['id', 'title'] },
  daily_records: { cols: ['id', 'day', 'mission', 'objective', 'biggest_win', 'biggest_challenge', 'learned', 'first_task_tomorrow', 'completed', 'created_at'], required: ['id', 'day'] },
  attachments: { cols: ['id', 'parent_type', 'parent_id', 'kind', 'status', 'error', 'filename', 'original_name', 'caption', 'alt_text', 'description', 'position', 'mime', 'byte_size', 'width', 'height', 'checksum', 'original_retained', 'optimized', 'extracted_text', 'extracted_source', 'extracted_edited', 'original_bytes', 'display_mime', 'display_bytes', 'thumb_bytes', 'created_at'], required: ['id', 'parent_type', 'parent_id', 'filename', 'mime', 'byte_size', 'checksum'] },
  relations: { cols: ['id', 'from_type', 'from_id', 'to_type', 'to_id', 'label', 'created_at'], required: ['id', 'from_type', 'from_id', 'to_type', 'to_id'] } }
/** Restore order respects foreign keys; relations/attachments come last. */
export const TABLE_ORDER: TableName[] = ['records', 'tasks', 'events', 'decisions', 'blockers', 'projects', 'daily_records', 'attachments', 'relations']
export const ENTITY_TABLES: TableName[] = ['records', 'tasks', 'events', 'decisions', 'blockers', 'projects', 'daily_records']
export type Row = Record<string, unknown>
export type Variant = 'original' | 'display' | 'thumb'
export interface Manifest {
  format: typeof FORMAT_ID; schema_version: string; created_at: string; encoding: 'utf-8'; app: string
  compression: string; contents: 'compact' | 'readable' | 'both'
  scope: { all: boolean; module_ids: string[] }; include_files: { originals: boolean; optimized: boolean; thumbnails: boolean }
  tables: Partial<Record<TableName, { file: string; rows: number; sha256: string }>>
  files: { path: string; attachment_id: string; variant: Variant; mime: string; bytes: number; sha256: string }[]
  missing_files: { attachment_id: string; variant: Variant; reason: string }[]
  counts: Record<string, number>
}
export const IMPORT_MD = `# Importing this archive

1. Open the app → Export & recovery → "Import / verify an archive" and choose this .zip file.
2. The app first VALIDATES without changing anything: manifest, schema version, SHA-256 of every file, safe file paths,
   unique record ids, and that every relationship, attachment parent, module and subtask reference resolves.
3. If validation passes you can restore. Existing records with the same id are skipped (never overwritten), so a restore
   can be re-run safely after an interruption.
4. Attachments whose image files were not included in the archive are restored as metadata-only ("failed: file not included")
   with captions, descriptions and extracted text intact; re-attach the same file to complete them.

You do not need the app to read the data: data/*.jsonl are UTF-8 JSON Lines (line 1 = column names, following lines = row arrays),
readable/ holds Markdown, and files/<attachment-id>/ holds images. See SCHEMA.md.
`
export const schemaMd = () => `# Archive schema ${SCHEMA_VERSION}

- manifest.json: format "${FORMAT_ID}", schema_version, created_at, encoding utf-8, scope, per-table file/row count/sha256, per-file path/bytes/sha256.
- data/<table>.jsonl: line 1 = {"table":..., "columns":[...]}; every other line is a JSON array in that column order.
  Dates are ISO strings; tags is an array; meta is an object; null means empty. IDs are UUIDs and are stable across export/import.
${Object.entries(TABLES).map(([t, d]) => `- ${t}: ${d.cols.join(', ')}`).join('\n')}
- Relationships: attachments.parent_type/parent_id and relations.from_*/to_* point to ids in the entity tables
  (${ENTITY_TABLES.join(', ')}); records.module_id points to a record of kind "module"; tasks.parent_id points to a task.
- files/<attachment_id>/original.<ext> | display.<ext> | thumb.webp : only the variants chosen at export time (see manifest.files).
- The ZIP stores text with DEFLATE; images are stored uncompressed because JPEG/WebP/PNG are already compressed.
`
