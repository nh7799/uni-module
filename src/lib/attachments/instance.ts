import type { AttachmentConfig } from './config'
import { browserProcessor } from './process'
import { createAttachmentService } from './service'
import { dbPort, storagePort } from './supabasePorts'
export const makeService = (userId: string, cfg: AttachmentConfig) => createAttachmentService({ db: dbPort, storage: storagePort, processor: browserProcessor(cfg), cfg, userId })
export const fmtBytes = (n: number | null | undefined) => n == null ? '—' : n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(2)} MB`
