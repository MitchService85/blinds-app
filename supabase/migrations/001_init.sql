-- Blinds measurement app: core tables + RLS allowlist.
-- Mirrors lib/types.ts. See docs/superpowers/specs/2026-08-12-measure-app-design.md
-- ("Auth" and "Data model" sections) for the design this implements.
--
-- DEPLOYED 2026-08-13 to the HyperFocus Supabase project (lmrtferwbyqpfhomtieu)
-- in a dedicated `blinds` schema, NOT `public`: the Supabase org is at its
-- 2-project free-tier cap, so this database is shared with HyperFocus, which
-- owns `public`. The client sets db:{schema:"blinds"} (lib/sync/index.ts), and
-- the schema is exposed to PostgREST via
--   alter role authenticator set pgrst.db_schemas = 'public, graphql_public, blinds';
-- Revert that with `reset pgrst.db_schemas` + `notify pgrst, 'reload config'`.
--
-- Access model: Supabase magic-link auth, no sign-up flow. Every table is
-- restricted to authenticated users whose JWT email appears in
-- blinds.allowed_users. The anon role gets nothing.

create extension if not exists "pgcrypto";

create schema if not exists blinds;
grant usage on schema blinds to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Allowlist
-- ---------------------------------------------------------------------------

create table if not exists blinds.allowed_users (
  email text primary key
);

-- Mitch's email, seeded now. Mike's is added later (see build plan: "Deferred
-- to launch conversation") via `insert into blinds.allowed_users (email) values (...)`.
insert into blinds.allowed_users (email)
values ('ms@mitchservice.com')
on conflict (email) do nothing;

alter table blinds.allowed_users enable row level security;
-- Intentionally no policies here: allowed_users is only ever consulted
-- through is_allowed_user() below, a security definer function that reads
-- it with the owning role's privileges (bypassing RLS). Direct queries
-- against this table from anon/authenticated are always denied.

-- True when the calling request's JWT email is present in allowed_users.
-- security definer + a pinned search_path so it can read allowed_users
-- despite that table having no RLS policies of its own.
create or replace function blinds.is_allowed_user()
returns boolean
language sql
security definer
set search_path = blinds, public
stable
as $$
  select exists (
    select 1
    from blinds.allowed_users
    where email = (auth.jwt() ->> 'email')
  );
$$;

grant execute on function blinds.is_allowed_user() to authenticated;

-- ---------------------------------------------------------------------------
-- projects
-- ---------------------------------------------------------------------------

create table if not exists blinds.projects (
  id uuid primary key default gen_random_uuid(),
  updated_at timestamptz not null default now(),
  deleted boolean not null default false,
  name text not null,
  address text not null default '',
  building_type text not null check (building_type in ('residential', 'commercial')),
  tag_chips jsonb not null default '[]'::jsonb
);

create index if not exists projects_updated_at_idx on blinds.projects (updated_at);

alter table blinds.projects enable row level security;

create policy "allowlisted users full access" on blinds.projects
  for all
  to authenticated
  using (blinds.is_allowed_user())
  with check (blinds.is_allowed_user());

-- ---------------------------------------------------------------------------
-- floors
-- ---------------------------------------------------------------------------

create table if not exists blinds.floors (
  id uuid primary key default gen_random_uuid(),
  updated_at timestamptz not null default now(),
  deleted boolean not null default false,
  project_id uuid not null references blinds.projects (id) on delete cascade,
  label text not null,
  -- { roll, drive, tight, extra_note, d_value, color_codes } — see FloorDefaults in lib/types.ts
  defaults jsonb not null default '{}'::jsonb,
  -- factory order number + site trip count, shown in the floor header for invoicing
  order_number text not null default '',
  trips integer
);

create index if not exists floors_updated_at_idx on blinds.floors (updated_at);
create index if not exists floors_project_id_idx on blinds.floors (project_id);

alter table blinds.floors enable row level security;

create policy "allowlisted users full access" on blinds.floors
  for all
  to authenticated
  using (blinds.is_allowed_user())
  with check (blinds.is_allowed_user());

-- ---------------------------------------------------------------------------
-- units
-- ---------------------------------------------------------------------------

create table if not exists blinds.units (
  id uuid primary key default gen_random_uuid(),
  updated_at timestamptz not null default now(),
  deleted boolean not null default false,
  floor_id uuid not null references blinds.floors (id) on delete cascade,
  number text not null,
  status text not null default 'active' check (status in ('active', 'na', 'done')),
  -- free-text punch-list note from the job site; never exported to the factory sheet
  note text not null default '',
  -- install lifecycle (independent of measure status); both steps optional
  install text check (install in ('staged', 'done')),
  -- yellow-ball flag: install blocked by an issue described in note
  install_blocked boolean not null default false,
  sort_order integer not null default 0
);

create index if not exists units_updated_at_idx on blinds.units (updated_at);
create index if not exists units_floor_id_idx on blinds.units (floor_id);

alter table blinds.units enable row level security;

create policy "allowlisted users full access" on blinds.units
  for all
  to authenticated
  using (blinds.is_allowed_user())
  with check (blinds.is_allowed_user());

-- ---------------------------------------------------------------------------
-- windows
-- ---------------------------------------------------------------------------

create table if not exists blinds.windows (
  id uuid primary key default gen_random_uuid(),
  updated_at timestamptz not null default now(),
  deleted boolean not null default false,
  unit_id uuid not null references blinds.units (id) on delete cascade,
  tag_base text not null,
  tag_index integer not null default 0,
  -- integer sixteenths of an inch, left to right; see lib/fractions.ts
  widths jsonb not null default '[]'::jsonb,
  height integer not null default 0,
  control_override text check (control_override is null or control_override in ('L', 'R')),
  deduct text check (deduct is null or deduct in ('Dl', 'Dr', 'D')),
  longer_chain boolean not null default false,
  note text not null default '',
  sort_order integer not null default 0
);

create index if not exists windows_updated_at_idx on blinds.windows (updated_at);
create index if not exists windows_unit_id_idx on blinds.windows (unit_id);

alter table blinds.windows enable row level security;

create policy "allowlisted users full access" on blinds.windows
  for all
  to authenticated
  using (blinds.is_allowed_user())
  with check (blinds.is_allowed_user());

-- ---------------------------------------------------------------------------
-- Explicit grants (defensive — most hosted Supabase projects already grant
-- these to authenticated by default privilege, but pin it here so the
-- migration is self-sufficient on a fresh project).
-- ---------------------------------------------------------------------------

grant select, insert, update, delete
  on blinds.projects, blinds.floors, blinds.units, blinds.windows
  to authenticated;
