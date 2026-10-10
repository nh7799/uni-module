# Project Mission Control
Vite + React + TypeScript + Tailwind + Supabase, deployable on Vercel.

## Setup
1. Install Node 18+. Run `npm install`.
2. Create a Supabase project. In the SQL editor, run `supabase/migrations/0001_core.sql` (tables + Row Level Security).
3. Copy `.env.example` to `.env.local` and fill `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` (Project Settings → API).
4. In Supabase → Authentication, enable Email. For quick testing, turn off "Confirm email".
5. `npm run dev` / `npm run build` / `npm run preview`.
6. First run: open Timeline and click "Load UH 2026/27 dates" (handbook v0.9; verify on Canvas).

## Vercel
Push to GitHub → import in Vercel (Vite preset) → add the two env vars under Settings → Environment Variables → deploy. `vercel.json` rewrites all routes to `index.html`, so refreshing `/timeline` etc. works.

## Upgrade note
Run `supabase/migrations/0002_guide.sql` after `0001_core.sql` (guided-journey progress).

## v3
New: Handbook, Checklist, Project library, search palette (Ctrl+K). No new migration needed beyond 0001 and 0002.

## v4 — academic knowledge base, attachments, export, health
Run `supabase/migrations/0003_academic_attachments.sql` after 0001 and 0002. It creates `records`, `attachments`, `relations`, `audit_log`, `export_log`, the private Storage bucket `attachments`, all RLS policies, and `search_all()`.

Pages: **Library** (14 record types, attachments, related records), **Tasks** (subtasks, attachments, links), **Export** (readable Markdown / compact JSONL in a ZIP, verify and restore), **Health** (counts, connectivity, integrity scan and safe repair).

### Storage layers
A structured data and B editable text (captions, descriptions, OCR text) live in PostgreSQL; C optimized images and thumbnails and D retained originals live in Storage at `<user_id>/<attachment_id>/<variant>`. No Base64 in the database. Compression happens in the browser (WebP, PNG kept for transparency, already-small files are not recompressed); header-based size/pixel limits and content sniffing run before decoding.

### Upload order and recovery
Row created (`uploading`) → processed → files uploaded → existence/size verified → `available`. A failure at any step leaves a `failed` row (retry resumes it; same bytes on the same record never duplicate). Replace stores and links the new file before removing the old one. Delete flags `pending_deletion`, removes files, then the row; leftovers are retried from Health. Health → Deep scan finds missing files and orphan folders; repairs never delete records.

### Tests
`npx tsx --test src/test/*.test.ts` (upload failures, interrupted processing, duplicate retries, missing files, failed metadata writes, archive round-trip/validation) and `scripts/test-db.sh` against a throwaway PostgreSQL (RLS isolation, cross-user attachment access, parent integrity, delete behaviour).

### Backups
Supabase's own database backups are not checked by this app (Dashboard → Database → Backups). Use Export monthly, verify the file on the Export page, and keep it outside the app. Restore: Export → choose archive → validate → Restore (idempotent; existing ids are skipped).
# uni-module
