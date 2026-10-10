export type ParentType = 'records' | 'tasks' | 'events' | 'decisions' | 'blockers' | 'projects' | 'daily_records'
export const PARENT_TYPES: ParentType[] = ['records', 'tasks', 'events', 'decisions', 'blockers', 'projects', 'daily_records']
export type Status = 'uploading' | 'processing' | 'stored' | 'available' | 'failed' | 'pending_deletion'
export type Mime = 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif' | 'image/avif' | 'application/pdf'
export interface Parent { type: ParentType; id: string }
export interface AttachmentRow {
  id: string; user_id?: string; parent_type: ParentType; parent_id: string; kind: 'image' | 'document'; status: Status; error: string | null
  filename: string; original_name: string | null; caption: string; alt_text: string; description: string; position: number
  mime: Mime; byte_size: number; width: number | null; height: number | null; checksum: string
  original_path: string | null; original_bytes: number | null; original_retained: boolean
  display_path: string | null; display_mime: string | null; display_bytes: number | null
  thumb_path: string | null; thumb_bytes: number | null; optimized: boolean
  extracted_text: string; extracted_source: 'ocr' | 'manual' | null; extracted_edited: boolean
  created_at?: string; updated_at?: string
}
export type NewAttachment = Pick<AttachmentRow, 'id' | 'parent_type' | 'parent_id' | 'kind' | 'status' | 'filename' | 'original_name' | 'mime' | 'byte_size' | 'checksum' | 'position'> & Partial<AttachmentRow>
export interface Blobish { bytes: Uint8Array; mime: string }
export interface DbError { code?: string; message: string }
/** Persistence of attachment metadata (PostgreSQL). */
export interface DbPort {
  insert(row: NewAttachment): Promise<{ row?: AttachmentRow; error?: DbError }>
  findByChecksum(p: Parent, checksum: string): Promise<AttachmentRow | null>
  get(id: string): Promise<AttachmentRow | null>
  update(id: string, patch: Partial<AttachmentRow>): Promise<{ error?: DbError }>
  list(p: Parent, includeInactive?: boolean): Promise<AttachmentRow[]>
  delete(id: string): Promise<{ error?: DbError }>
}
/** File objects (Supabase Storage). */
export interface StoragePort {
  upload(path: string, file: Blobish): Promise<{ error?: DbError }>
  download(path: string): Promise<Uint8Array | null>
  remove(paths: string[]): Promise<{ error?: DbError }>
  /** true only if the object exists and (when given) has exactly that many bytes */
  exists(path: string, bytes?: number): Promise<boolean>
  signedUrl(path: string, ttlSeconds: number): Promise<string | null>
}
export interface ProcessedImage { display: Blobish | null; thumb: Blobish | null; width: number; height: number; optimized: boolean }
export interface ImageProcessor { process(bytes: Uint8Array, info: { mime: Mime; width: number; height: number }, signal: AbortSignal): Promise<ProcessedImage> }
export type Stage = 'validating' | 'saving record' | 'processing' | 'uploading' | 'verifying' | 'done'
export class UploadError extends Error { constructor(public code: string, message: string) { super(message) } }
