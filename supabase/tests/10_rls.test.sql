-- Run after migrations 0001-0003. Raises an exception on the first failed assertion.
\set ON_ERROR_STOP on
grant select, insert, update, delete on all tables in schema public to authenticated;
revoke insert, update, delete on audit_log from authenticated; -- mirrors the migration (Supabase default grants are re-revoked there)
grant select, insert, update, delete on all tables in schema storage to authenticated;
grant usage, select on all sequences in schema public to authenticated;
insert into auth.users values ('aaaaaaaa-0000-0000-0000-000000000001'), ('bbbbbbbb-0000-0000-0000-000000000002');

create function pg_temp.expect_error(sql text, code text) returns void language plpgsql as $$
begin
  begin execute sql; exception when others then
    if sqlstate = code then return; end if;
    raise exception 'expected SQLSTATE % but got % (%) for: %', code, sqlstate, sqlerrm, sql;
  end;
  raise exception 'expected SQLSTATE % but statement succeeded: %', code, sql;
end $$;
grant execute on function pg_temp.expect_error(text, text) to authenticated;

set role authenticated;
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000001';
insert into records(id, kind, title) values ('11111111-0000-0000-0000-000000000001', 'module', 'Algorithms');
insert into records(id, kind, title, body, module_id) values ('11111111-0000-0000-0000-000000000002', 'note', 'Sorting', 'quicksort pivot', '11111111-0000-0000-0000-000000000001');
insert into tasks(id, title) values ('22222222-0000-0000-0000-000000000001', 'Do lab');
insert into attachments(id, parent_type, parent_id, filename, mime, byte_size, checksum, status, display_path, extracted_text)
 values ('33333333-0000-0000-0000-000000000001', 'records', '11111111-0000-0000-0000-000000000002', 'whiteboard', 'image/webp', 1000, repeat('a',64), 'available',
         'aaaaaaaa-0000-0000-0000-000000000001/33333333-0000-0000-0000-000000000001/display.webp', 'invariant loop termination');
insert into relations(from_type, from_id, to_type, to_id, label) values ('records','11111111-0000-0000-0000-000000000002','tasks','22222222-0000-0000-0000-000000000001','prepares for');
insert into storage.objects(bucket_id, name) values ('attachments', 'aaaaaaaa-0000-0000-0000-000000000001/33333333-0000-0000-0000-000000000001/display.webp');
do $$ begin
  -- duplicate retry cannot create a second row
  perform pg_temp.expect_error($q$insert into attachments(parent_type,parent_id,filename,mime,byte_size,checksum) values ('records','11111111-0000-0000-0000-000000000002','dup','image/png',5,repeat('a',64))$q$, '23505');
  -- files need a metadata row first
  perform pg_temp.expect_error($q$insert into storage.objects(bucket_id,name) values ('attachments','aaaaaaaa-0000-0000-0000-000000000001/99999999-0000-0000-0000-000000000009/x.webp')$q$, '42501');
  -- cannot claim another user's storage prefix in metadata
  perform pg_temp.expect_error($q$update attachments set display_path='bbbbbbbb-0000-0000-0000-000000000002/x/y.webp' where id='33333333-0000-0000-0000-000000000001'$q$, '23514');
  -- 'available' needs a file path
  perform pg_temp.expect_error($q$insert into attachments(parent_type,parent_id,filename,mime,byte_size,checksum,status) values ('records','11111111-0000-0000-0000-000000000002','x','image/png',5,repeat('c',64),'available')$q$, '23514');
  -- module with children cannot be deleted
  perform pg_temp.expect_error($q$delete from records where id='11111111-0000-0000-0000-000000000001'$q$, '23503');
  -- audit log is append-only for users
  perform pg_temp.expect_error($q$delete from audit_log$q$, '42501');
  perform pg_temp.expect_error($q$insert into audit_log(user_id,action,entity_type) values (auth.uid(),'x','y')$q$, '42501');
  -- search finds OCR text
  if (select count(*) from search_all('invariant')) <> 1 then raise exception 'search_all missed OCR text'; end if;
  if (select count(*) from search_all('quicksort')) <> 1 then raise exception 'search_all missed record body'; end if;
end $$;

-- ---- user B ----
set request.jwt.claim.sub = 'bbbbbbbb-0000-0000-0000-000000000002';
do $$ begin
  if (select count(*) from records) <> 0 or (select count(*) from attachments) <> 0 or (select count(*) from relations) <> 0
     or (select count(*) from audit_log) <> 0 or (select count(*) from storage.objects) <> 0 then raise exception 'B can see A data'; end if;
  if (select count(*) from search_all('invariant')) <> 0 then raise exception 'B can search A data'; end if;
  perform pg_temp.expect_error($q$insert into attachments(parent_type,parent_id,filename,mime,byte_size,checksum) values ('records','11111111-0000-0000-0000-000000000002','steal','image/png',5,repeat('d',64))$q$, '23503');
  perform pg_temp.expect_error($q$insert into relations(from_type,from_id,to_type,to_id) values ('records','11111111-0000-0000-0000-000000000002','records','11111111-0000-0000-0000-000000000001')$q$, '23503');
  perform pg_temp.expect_error($q$insert into storage.objects(bucket_id,name) values ('attachments','aaaaaaaa-0000-0000-0000-000000000001/33333333-0000-0000-0000-000000000001/evil.webp')$q$, '42501');
  declare n int; begin
    delete from attachments; get diagnostics n = row_count; if n <> 0 then raise exception 'B deleted A attachments'; end if;
    update records set title = 'pwn'; get diagnostics n = row_count; if n <> 0 then raise exception 'B updated A records'; end if;
  end;
end $$;

-- ---- back to A: deleting a note flags attachments, removes relations, and is audited ----
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000001';
delete from records where id = '11111111-0000-0000-0000-000000000002';
do $$ begin
  if (select status from attachments where id='33333333-0000-0000-0000-000000000001') <> 'pending_deletion' then raise exception 'attachment not flagged'; end if;
  if (select count(*) from relations) <> 0 then raise exception 'relations not cleaned'; end if;
  if (select count(*) from audit_log where entity_type='records' and action='delete') <> 1 then raise exception 'delete not audited'; end if;
  if (select count(*) from search_all('invariant')) <> 0 then raise exception 'pending_deletion still searchable'; end if;
  -- the same bytes may be re-attached after the old row is pending deletion
  delete from records where id = '11111111-0000-0000-0000-000000000001';
end $$;
select 'ALL DB TESTS PASSED' as result;
