-- 0003: academic records, attachments (Supabase Storage + metadata), relations, audit, export log.
-- Run after 0001 and 0002. Everything is per-user via Row Level Security.

-- ---------- Layer A/B: structured + editable text ----------
create table records(
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  kind text not null check (kind in ('module','timetable','lecture','note','resource','assessment','programming_note','fyp_research','fyp_milestone','experiment','meeting','revision_card','research_source','knowledge')),
  title text not null check (length(trim(title)) > 0),
  body text not null default '',
  meta jsonb not null default '{}'::jsonb,           -- e.g. {"code":"6COM1234","due":"2026-12-01","url":"..."}
  occurred_on date,                                  -- lecture date, meeting date, deadline, ...
  module_id uuid references records(id) on delete restrict,  -- never silently orphan children of a module
  tags text[] not null default '{}',
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  fts tsvector generated always as (to_tsvector('english', coalesce(title,'') || ' ' || coalesce(body,''))) stored,
  check (module_id is null or module_id <> id)
);
create index on records(user_id, kind);
create index on records(module_id);
create index records_fts on records using gin(fts);
create index records_tags on records using gin(tags);

alter table tasks add column if not exists parent_id uuid references tasks(id) on delete restrict;  -- subtasks
alter table tasks add column if not exists notes text;

-- ---------- Layer C/D: attachment metadata (files live in Storage) ----------
create table attachments(
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  parent_type text not null check (parent_type in ('records','tasks','events','decisions','blockers','projects','daily_records')),
  parent_id uuid not null,
  kind text not null default 'image' check (kind in ('image','document')),
  status text not null default 'uploading' check (status in ('uploading','processing','stored','available','failed','pending_deletion')),
  error text,
  filename text not null check (length(trim(filename)) > 0),   -- descriptive, editable
  original_name text,
  caption text not null default '',
  alt_text text not null default '',
  description text not null default '',                         -- manual explanation of a diagram/graph
  position int not null default 0,
  mime text not null check (mime in ('image/jpeg','image/png','image/webp','image/gif','image/avif','application/pdf')),
  byte_size bigint not null check (byte_size > 0),              -- size of the file as uploaded
  width int, height int,
  checksum text not null check (checksum ~ '^[0-9a-f]{64}$'),   -- sha256 of the uploaded original
  original_path text, original_bytes bigint, original_retained boolean not null default false,
  display_path text, display_mime text, display_bytes bigint,
  thumb_path text, thumb_bytes bigint,
  optimized boolean not null default false,                     -- true when display version is a recompression
  extracted_text text not null default '',
  extracted_source text check (extracted_source in ('ocr','manual')),
  extracted_edited boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  fts tsvector generated always as (to_tsvector('english',
    coalesce(filename,'')||' '||coalesce(caption,'')||' '||coalesce(alt_text,'')||' '||coalesce(description,'')||' '||coalesce(extracted_text,''))) stored,
  check (original_path is null or original_path like user_id::text || '/%'),
  check (display_path  is null or display_path  like user_id::text || '/%'),
  check (thumb_path    is null or thumb_path    like user_id::text || '/%'),
  check (status <> 'available' or (display_path is not null or original_path is not null))
);
create index on attachments(user_id, parent_type, parent_id, position);
create index on attachments(user_id, status);
create index attachments_fts on attachments using gin(fts);
-- duplicate-retry protection: same bytes cannot be attached twice to the same parent
create unique index attachments_no_dupes on attachments(user_id, parent_type, parent_id, checksum) where status <> 'pending_deletion';

-- ---------- Universal relationships ----------
create table relations(
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  from_type text not null check (from_type in ('records','tasks','events','decisions','blockers','projects','daily_records')),
  from_id uuid not null,
  to_type text not null check (to_type in ('records','tasks','events','decisions','blockers','projects','daily_records')),
  to_id uuid not null,
  label text not null default 'related to' check (length(trim(label)) between 1 and 60),
  created_at timestamptz not null default now(),
  check (not (from_type = to_type and from_id = to_id)),
  unique(user_id, from_type, from_id, to_type, to_id, label)
);
create index on relations(user_id, from_type, from_id);
create index on relations(user_id, to_type, to_id);

-- ---------- Audit history (append-only for users) ----------
create table audit_log(
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users on delete cascade,
  action text not null, entity_type text not null, entity_id uuid, detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now());
create index on audit_log(user_id, created_at desc);

-- ---------- Export / verification / import log ----------
create table export_log(
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  kind text not null check (kind in ('export','verify','import')),
  format text, ok boolean not null default true,
  bytes bigint, uncompressed_bytes bigint, record_count int,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now());
create index on export_log(user_id, kind, created_at desc);

-- ---------- RLS ----------
do $$ declare t text; begin foreach t in array array['records','attachments','relations','export_log'] loop
  execute format('alter table %I enable row level security', t);
  execute format('create policy "own rows" on %I for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id)', t);
end loop; end $$;
alter table audit_log enable row level security;
create policy "read own audit" on audit_log for select to authenticated using (auth.uid() = user_id);
-- no insert/update/delete policy and no privilege: only the SECURITY DEFINER trigger below can write.
revoke insert, update, delete, truncate on audit_log from authenticated, anon;

-- ---------- Integrity functions ----------
create or replace function public.parent_exists(p_type text, p_id uuid) returns boolean
language plpgsql stable security invoker as $$
declare ok boolean;
begin
  if p_type not in ('records','tasks','events','decisions','blockers','projects','daily_records') then return false; end if;
  execute format('select exists(select 1 from public.%I where id = $1)', p_type) into ok using p_id;  -- RLS applies: only own rows are visible
  return ok;
end $$;

create or replace function public.check_attachment_parent() returns trigger language plpgsql as $$
begin
  if not public.parent_exists(new.parent_type, new.parent_id) then
    raise exception 'attachment parent %/% does not exist or is not yours', new.parent_type, new.parent_id using errcode = '23503';
  end if;
  return new;
end $$;
create trigger attachments_parent_check before insert or update of parent_type, parent_id on attachments for each row execute function public.check_attachment_parent();

create or replace function public.check_relation_ends() returns trigger language plpgsql as $$
begin
  if not public.parent_exists(new.from_type, new.from_id) or not public.parent_exists(new.to_type, new.to_id) then
    raise exception 'relation endpoint does not exist or is not yours' using errcode = '23503';
  end if;
  return new;
end $$;
create trigger relations_ends_check before insert or update on relations for each row execute function public.check_relation_ends();

-- When a parent is hard-deleted: its attachments are flagged pending_deletion (files are removed by the
-- reconcile/purge job, never left dangling) and relations touching it are removed. Both are audited.
create or replace function public.parent_deleted() returns trigger language plpgsql as $$
declare n_att int; n_rel int;
begin
  update attachments set status = 'pending_deletion', updated_at = now() where parent_type = tg_table_name and parent_id = old.id and status <> 'pending_deletion';
  get diagnostics n_att = row_count;
  delete from relations where (from_type = tg_table_name and from_id = old.id) or (to_type = tg_table_name and to_id = old.id);
  get diagnostics n_rel = row_count;
  return old;
end $$;

create or replace function public.touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
create trigger records_touch before update on records for each row execute function public.touch_updated_at();
create trigger attachments_touch before update on attachments for each row execute function public.touch_updated_at();

create or replace function public.audit() returns trigger language plpgsql security definer set search_path = public as $$
declare r record; d jsonb;
begin
  r := case when tg_op = 'DELETE' then old else new end;
  d := jsonb_build_object('title', to_jsonb(r) -> 'title', 'status', to_jsonb(r) -> 'status', 'parent_type', to_jsonb(r) -> 'parent_type', 'parent_id', to_jsonb(r) -> 'parent_id');
  insert into audit_log(user_id, action, entity_type, entity_id, detail) values (r.user_id, lower(tg_op), tg_table_name, r.id, d);
  return r;
end $$;

do $$ declare t text; begin
  foreach t in array array['records','tasks','events','decisions','blockers','projects','daily_records'] loop
    execute format('create trigger parent_deleted_%1$s after delete on %1$I for each row execute function public.parent_deleted()', t);
  end loop;
  foreach t in array array['records','attachments','relations','tasks'] loop
    execute format('create trigger audit_%1$s after insert or update or delete on %1$I for each row execute function public.audit()', t);
  end loop;
end $$;

-- ---------- Search across records and attachment text (descriptions + OCR) ----------
create or replace function public.search_all(q text, lim int default 20)
returns table(entity_type text, entity_id uuid, parent_type text, parent_id uuid, title text, snippet text, rank real)
language sql stable security invoker as $$
  with tq as (select websearch_to_tsquery('english', q) as t)
  select 'records', r.id, null::text, null::uuid, r.title, left(r.body, 160), ts_rank(r.fts, tq.t)
    from records r, tq where r.fts @@ tq.t or r.title ilike '%' || q || '%' or r.tags @> array[q]
  union all
  select 'attachments', a.id, a.parent_type, a.parent_id, a.filename,
         left(coalesce(nullif(a.caption,''), nullif(a.description,''), a.extracted_text), 160), ts_rank(a.fts, tq.t)
    from attachments a, tq where a.status <> 'pending_deletion' and (a.fts @@ tq.t or a.filename ilike '%' || q || '%')
  order by 7 desc limit lim
$$;

-- ---------- Storage bucket + policies ----------
-- Object path convention: <user_id>/<attachment_id>/<variant>.<ext>
insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('attachments', 'attachments', false, 26214400,
        array['image/jpeg','image/png','image/webp','image/gif','image/avif','application/pdf'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create policy "attachments read own" on storage.objects for select to authenticated
  using (bucket_id = 'attachments' and (storage.foldername(name))[1] = auth.uid()::text);
-- A file can only be written if a metadata row for it already exists (rows are created first), so no stray uploads.
create policy "attachments insert own with row" on storage.objects for insert to authenticated
  with check (bucket_id = 'attachments' and (storage.foldername(name))[1] = auth.uid()::text
    and exists (select 1 from public.attachments a where a.user_id = auth.uid() and a.id::text = (storage.foldername(name))[2]));
create policy "attachments update own" on storage.objects for update to authenticated
  using (bucket_id = 'attachments' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "attachments delete own" on storage.objects for delete to authenticated
  using (bucket_id = 'attachments' and (storage.foldername(name))[1] = auth.uid()::text);
