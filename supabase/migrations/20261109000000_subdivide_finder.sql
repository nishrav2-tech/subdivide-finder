-- Subdivide Finder tables for the Utopian CRM Supabase project (yahosblylysopbxgztvg).
-- Everything is prefixed sf_ so no CRM table is touched. Safe to run more than once.

-- Who may use Subdivide Finder (matched against the signed-in user's email).
create table if not exists public.sf_members (
  email text primary key,
  added_at timestamptz not null default now()
);
-- Add team members after running this file (kept out of git):
--   insert into public.sf_members (email) values ('you@example.com')
insert into public.sf_members (email) select 'placeholder@invalid' where false
on conflict (email) do nothing;

create or replace function public.sf_is_member()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from public.sf_members
    where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;
revoke all on function public.sf_is_member() from public;
grant execute on function public.sf_is_member() to authenticated;

-- One row per document. The page reads and writes `doc`; the trigger below
-- copies a few fields into real columns so they are easy to query.
create table if not exists public.sf_runs (
  id text primary key,
  status text,
  doc jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
create table if not exists public.sf_deals (
  id text primary key,
  run_id text,
  screen text,
  stage text,
  doc jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
create table if not exists public.sf_outreach (
  id text primary key,            -- Gmail thread id
  deal_id text,
  run_id text,
  doc jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
create table if not exists public.sf_ideas (
  id text primary key,            -- Gmail thread id
  state text,
  doc jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create index if not exists sf_runs_status_idx on public.sf_runs (status);
create index if not exists sf_deals_run_idx on public.sf_deals (run_id);
create index if not exists sf_outreach_deal_idx on public.sf_outreach (deal_id);

create or replace function public.sf_sync_cols()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  if tg_table_name = 'sf_runs' then
    new.status := new.doc ->> 'status';
  elsif tg_table_name = 'sf_deals' then
    new.run_id := new.doc ->> 'runId';
    new.screen := new.doc ->> 'screen';
    new.stage := new.doc ->> 'stage';
  elsif tg_table_name = 'sf_outreach' then
    new.run_id := coalesce(new.doc ->> 'runId', new.doc ->> 'search');
    new.deal_id := new.doc ->> 'dealId';
  elsif tg_table_name = 'sf_ideas' then
    new.state := new.doc ->> 'state';
  end if;
  return new;
end;
$$;

do $$
declare t text;
begin
  foreach t in array array['sf_runs','sf_deals','sf_outreach','sf_ideas'] loop
    execute format('drop trigger if exists %I_sync on public.%I', t, t);
    execute format('create trigger %I_sync before insert or update on public.%I for each row execute function public.sf_sync_cols()', t, t);
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "sf members only" on public.%I', t);
    execute format('create policy "sf members only" on public.%I for all to authenticated using (public.sf_is_member()) with check (public.sf_is_member())', t);
  end loop;
end $$;

alter table public.sf_members enable row level security;
drop policy if exists "sf members read" on public.sf_members;
create policy "sf members read" on public.sf_members for select to authenticated using (public.sf_is_member());

-- Live updates on the page.
do $$
declare t text;
begin
  foreach t in array array['sf_runs','sf_deals','sf_outreach','sf_ideas'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- Only signed-in users may call the membership check.
revoke execute on function public.sf_is_member() from public, anon;
grant execute on function public.sf_is_member() to authenticated;
