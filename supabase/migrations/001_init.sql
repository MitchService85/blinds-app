-- Blinds measurement app: core tables + RLS allowlist.
-- Mirrors lib/types.ts. See docs/superpowers/specs/2026-08-12-measure-app-design.md
-- ("Auth" and "Data model" sections) for the design this implements.
--
-- Access model: Supabase magic-link auth, no sign-up flow. Every table is
-- restricted to authenticated users whose JWT email appears in
-- allowed_users. The anon role gets nothing — policies are scoped
-- `to authenticated` only, so RLS default-denies anon regardless.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Allowlist
-- ---------------------------------------------------------------------------

create table if not exists allowed_users (
  email text primary key
);

-- Mitch's email, seeded now. Mike's is added later (see build plan: "Deferred
-- to launch conversation") via `insert into allowed_users (email) values (...)`.
insert into allowed_users (email)
values ('ms@mitchservice.com')
on conflict (email) do nothing;

alter table allowed_users enable row level security;
-- Intentionally no policies here: allowed_users is only ever consulted
-- through is_allowed_user() below, a security definer function that reads
-- it with the owning role's privileges (bypassing RLS). Direct queries
-- against this table from anon/authenticated are always denied.

-- True when the calling request's JWT email is present in allowed_users.
-- security definer + a pinned search_path so it can read allowed_users
-- despite that table having no RLS policies of its own.
create or replace function is_allowed_user()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from allowed_users
    where email = (auth.jwt() ->> 'email')
  );
$$;

grant execute on function is_allowed_user() to authenticated;

-- ---------------------------------------------------------------------------
-- projects
-- ---------------------------------------------------------------------------

create table if not exists projects (
  id uuid primary key default gen_random_uuid(),
  updated_at timestamptz not null default now(),
  deleted boolean not null default false,
  name text not null,
  address text not null default '',
  building_type text not null check (building_type in ('residential', 'commercial')),
  tag_chips jsonb not null default '[]'::jsonb
);

create index if not exists projects_updated_at_idx on projects (updated_at);

alter table projects enable row level security;

create policy "allowlisted users full access" on projects
  for all
  to authenticated
  using (is_allowed_user())
  with check (is_allowed_user());

-- ---------------------------------------------------------------------------
-- floors
-- ---------------------------------------------------------------------------

create table if not exists floors (
  id uuid primary key default gen_random_uuid(),
  updated_at timestamptz not null default now(),
  deleted boolean not null default false,
  project_id uuid not null references projects (id) on delete cascade,
  label text not null,
  -- { roll, drive, tight, extra_note, d_value, color_codes } — see FloorDefaults in lib/types.ts
  defaults jsonb not null default '{}'::jsonb
);

create index if not exists floors_updated_at_idx on floors (updated_at);
create index if not exists floors_project_id_idx on floors (project_id);

alter table floors enable row level security;

create policy "allowlisted users full access" on floors
  for all
  to authenticated
  using (is_allowed_user())
  with check (is_allowed_user());

-- ---------------------------------------------------------------------------
-- units
-- ---------------------------------------------------------------------------

create table if not exists units (
  id uuid primary key default gen_random_uuid(),
  updated_at timestamptz not null default now(),
  deleted boolean not null default false,
  floor_id uuid not null references floors (id) on delete cascade,
  number text not null,
  status text not null default 'active' check (status in ('active', 'na', 'done')),
  sort_order integer not null default 0
);

create index if not exists units_updated_at_idx on units (updated_at);
create index if not exists units_floor_id_idx on units (floor_id);

alter table units enable row level security;

create policy "allowlisted users full access" on units
  for all
  to authenticated
  using (is_allowed_user())
  with check (is_allowed_user());

-- ---------------------------------------------------------------------------
-- windows
-- ---------------------------------------------------------------------------

create table if not exists windows (
  id uuid primary key default gen_random_uuid(),
  updated_at timestamptz not null default now(),
  deleted boolean not null default false,
  unit_id uuid not null references units (id) on delete cascade,
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

create index if not exists windows_updated_at_idx on windows (updated_at);
create index if not exists windows_unit_id_idx on windows (unit_id);

alter table windows enable row level security;

create policy "allowlisted users full access" on windows
  for all
  to authenticated
  using (is_allowed_user())
  with check (is_allowed_user());

-- ---------------------------------------------------------------------------
-- Explicit grants (defensive — most hosted Supabase projects already grant
-- these to authenticated by default privilege, but pin it here so the
-- migration is self-sufficient on a fresh project).
-- ---------------------------------------------------------------------------

grant select, insert, update, delete on projects, floors, units, windows to authenticated;
