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
