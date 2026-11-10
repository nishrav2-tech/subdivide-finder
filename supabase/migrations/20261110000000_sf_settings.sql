-- Saved settings for Subdivide Finder (default search criteria and outreach rules).
create table if not exists public.sf_settings (
  id text primary key,            -- e.g. 'criteria'
  doc jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.sf_settings enable row level security;
drop policy if exists "sf members only" on public.sf_settings;
create policy "sf members only" on public.sf_settings for all to authenticated
  using (public.sf_is_member()) with check (public.sf_is_member());
do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'sf_settings') then
    alter publication supabase_realtime add table public.sf_settings;
  end if;
end $$;

-- Private file storage for deal documents (surveys, plats, tests).
insert into storage.buckets (id, name, public, file_size_limit)
values ('sf-files', 'sf-files', false, 52428800)
on conflict (id) do nothing;
drop policy if exists "sf files read" on storage.objects;
drop policy if exists "sf files insert" on storage.objects;
drop policy if exists "sf files update" on storage.objects;
drop policy if exists "sf files delete" on storage.objects;
create policy "sf files read" on storage.objects for select to authenticated using (bucket_id = 'sf-files' and public.sf_is_member());
create policy "sf files insert" on storage.objects for insert to authenticated with check (bucket_id = 'sf-files' and public.sf_is_member());
create policy "sf files update" on storage.objects for update to authenticated using (bucket_id = 'sf-files' and public.sf_is_member()) with check (bucket_id = 'sf-files' and public.sf_is_member());
create policy "sf files delete" on storage.objects for delete to authenticated using (bucket_id = 'sf-files' and public.sf_is_member());
