create table guide_progress(id uuid primary key default gen_random_uuid(), user_id uuid not null default auth.uid() references auth.users on delete cascade, step_key text not null, created_at timestamptz default now(), unique(user_id, step_key));
alter table guide_progress enable row level security;
create policy "own rows" on guide_progress for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
