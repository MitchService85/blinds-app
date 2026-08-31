-- Measure: multi-tenant schema, consolidated.
--
-- Project: `measure` (ucvvxgussmnyuaexaaxj, ca-central-1) — a DEDICATED
-- database. The app previously lived in a `blinds` schema inside the
-- HyperFocus project because the org was at its free-project cap; that
-- arrangement ends here. Tables live in `public` on their own project now.
--
-- Isolation model (see docs/superpowers/specs/2026-08-30-multi-tenant-companies-design.md):
-- every tenant-owned row carries company_id, and RLS resolves the caller's
-- company through a LIVE membership lookup. A removed member loses access on
-- their next request rather than at token expiry.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Tenancy
-- ---------------------------------------------------------------------------

create table if not exists companies (
  id uuid primary key default gen_random_uuid(),
  updated_at timestamptz not null default now(),
  deleted boolean not null default false,
  name text not null,
  -- Branding, consumed by quoting later. Logo is an inline compressed data
  -- URL (same pattern as unit photos: no blob storage to fail in a dead zone).
  logo text not null default '',
  accent_color text not null default '',
  quote_footer text not null default ''
);

create table if not exists memberships (
  id uuid primary key default gen_random_uuid(),
  updated_at timestamptz not null default now(),
  deleted boolean not null default false,
  company_id uuid not null references companies (id) on delete cascade,
  -- Null until the invited person first signs in; matched by email until then.
  user_id uuid references auth.users (id) on delete cascade,
  email text not null,
  role text not null default 'member' check (role in ('admin', 'member')),
  status text not null default 'invited' check (status in ('invited', 'active'))
);

-- Emails are matched case-insensitively: GoTrue lowercases the address in the
-- JWT, and Mike's has a capital M — storing it as typed once locked him out.
create unique index if not exists memberships_company_email_idx
  on memberships (company_id, lower(email)) where not deleted;
-- v1: one company per person. Deferred multi-company support (Mike works both
-- Keep It Shady and Le Decor) means dropping THIS index and adding an
-- active-company switcher; no data migration. See the spec's known-limitation
-- section before onboarding a company that shares crew with another tenant.
create unique index if not exists memberships_email_idx
  on memberships (lower(email)) where not deleted;
create index if not exists memberships_user_idx on memberships (user_id);
create index if not exists memberships_updated_at_idx on memberships (updated_at);

-- Mitch. Grants exactly two abilities: create a company, and manage its first
-- invite. Deliberately grants NO read access to tenant data — support access
-- can be added later with consent, and "your measurements aren't visible even
-- to us" is a real line in the sales conversation.
create table if not exists platform_admins (
  user_id uuid primary key references auth.users (id) on delete cascade
);

-- ---------------------------------------------------------------------------
-- Resolution helpers (security definer: they read tables the caller cannot)
-- ---------------------------------------------------------------------------

-- The caller's company, via their ACTIVE membership. Null when the signed-in
-- user belongs to no company — every tenant policy then denies by default.
create or replace function current_company_id()
returns uuid
language sql
security definer
set search_path = public
stable
as $$
  select m.company_id
  from memberships m
  where not m.deleted
    and m.status = 'active'
    and (m.user_id = auth.uid() or lower(m.email) = lower(auth.jwt() ->> 'email'))
  limit 1;
$$;

create or replace function is_company_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from memberships m
    where not m.deleted
      and m.status = 'active'
      and m.role = 'admin'
      and (m.user_id = auth.uid() or lower(m.email) = lower(auth.jwt() ->> 'email'))
  );
$$;

create or replace function is_platform_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (select 1 from platform_admins where user_id = auth.uid());
$$;

grant execute on function current_company_id(), is_company_admin(), is_platform_admin()
  to authenticated;

-- ---------------------------------------------------------------------------
-- Tenant tables
-- ---------------------------------------------------------------------------

create table if not exists projects (
  id uuid primary key default gen_random_uuid(),
  updated_at timestamptz not null default now(),
  deleted boolean not null default false,
  company_id uuid not null references companies (id) on delete cascade,
  name text not null,
  address text not null default '',
  building_type text not null check (building_type in ('residential', 'commercial')),
  tag_chips jsonb not null default '[]'::jsonb
);

create table if not exists floors (
  id uuid primary key default gen_random_uuid(),
  updated_at timestamptz not null default now(),
  deleted boolean not null default false,
  company_id uuid not null references companies (id) on delete cascade,
  project_id uuid not null references projects (id) on delete cascade,
  label text not null,
  -- { roll, drive, tight, measure, mount, motorized, chain_type, extra_note,
  --   d_value, color_codes {mbed, liv, bed, kit, stu} } — see FloorDefaults.
  -- `measure` (null|tight|finished) supersedes the legacy `tight` boolean,
  -- which writers still maintain so older bundles keep resolving correctly.
  defaults jsonb not null default '{}'::jsonb,
  order_number text not null default '',
  trips integer
);

create table if not exists units (
  id uuid primary key default gen_random_uuid(),
  updated_at timestamptz not null default now(),
  deleted boolean not null default false,
  company_id uuid not null references companies (id) on delete cascade,
  floor_id uuid not null references floors (id) on delete cascade,
  number text not null,
  status text not null default 'active' check (status in ('active', 'na', 'done')),
  note text not null default '',
  install text check (install in ('staged', 'done')),
  install_blocked boolean not null default false,
  sort_order integer not null default 0
);

create table if not exists windows (
  id uuid primary key default gen_random_uuid(),
  updated_at timestamptz not null default now(),
  deleted boolean not null default false,
  company_id uuid not null references companies (id) on delete cascade,
  unit_id uuid not null references units (id) on delete cascade,
  tag_base text not null,
  tag_index integer not null default 0,
  -- integer sixteenths of an inch, left to right
  widths jsonb not null default '[]'::jsonb,
  height integer not null default 0,
  quantity integer not null default 1,
  control_override text check (control_override is null or control_override in ('L', 'R')),
  -- per-panel control side, parallel to widths; layered over control_override
  panel_controls jsonb,
  -- 'inside_tight' predates the mount/tight split and means "measured tight";
  -- readers normalise it. Kept accepted so older bundles keep syncing.
  mount_override text check (mount_override is null or mount_override in ('inside_tight', 'inside', 'outside')),
  tight_override boolean,
  deduct text check (deduct is null or deduct in ('Dl', 'Dr', 'D')),
  chain_length integer check (chain_length is null or chain_length > 0),
  longer_chain boolean not null default false,
  motorized_override boolean,
  checks_ack boolean not null default false,
  note text not null default '',
  -- per-blind install issues; issue_fault is the recut BILLING record
  issue_note text not null default '',
  issue_fault text check (issue_fault is null or issue_fault in ('factory', 'measure')),
  issue_recut boolean not null default false,
  sort_order integer not null default 0
);

create table if not exists photos (
  id uuid primary key default gen_random_uuid(),
  updated_at timestamptz not null default now(),
  deleted boolean not null default false,
  company_id uuid not null references companies (id) on delete cascade,
  unit_id uuid not null references units (id) on delete cascade,
  data text not null
);

create table if not exists exports (
  id uuid primary key default gen_random_uuid(),
  updated_at timestamptz not null default now(),
  deleted boolean not null default false,
  company_id uuid not null references companies (id) on delete cascade,
  floor_id uuid not null references floors (id) on delete cascade,
  exported_at timestamptz not null,
  filename text not null default '',
  blind_count integer not null default 0,
  -- the ExportInput that produced the workbook, not the .xlsx bytes
  input jsonb not null default '{}'::jsonb
);

-- Sync pulls page by (updated_at, id); company_id leads because every query is
-- tenant-scoped by RLS.
create index if not exists projects_sync_idx on projects (company_id, updated_at, id);
create index if not exists floors_sync_idx on floors (company_id, updated_at, id);
create index if not exists units_sync_idx on units (company_id, updated_at, id);
create index if not exists windows_sync_idx on windows (company_id, updated_at, id);
create index if not exists photos_sync_idx on photos (company_id, updated_at, id);
create index if not exists exports_sync_idx on exports (company_id, updated_at, id);

create index if not exists floors_project_idx on floors (project_id);
create index if not exists units_floor_idx on units (floor_id);
create index if not exists windows_unit_idx on windows (unit_id);
create index if not exists photos_unit_idx on photos (unit_id);
create index if not exists exports_floor_idx on exports (floor_id, exported_at);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table companies enable row level security;
alter table memberships enable row level security;
alter table platform_admins enable row level security;
alter table projects enable row level security;
alter table floors enable row level security;
alter table units enable row level security;
alter table windows enable row level security;
alter table photos enable row level security;
alter table exports enable row level security;

-- platform_admins: readable by nobody through the API. Consulted only by
-- is_platform_admin(), a security-definer function.

-- A member reads their own company; an admin renames it and sets branding.
-- A platform admin may CREATE a company but deliberately cannot read one.
create policy companies_read on companies
  for select to authenticated
  using (id = current_company_id());
create policy companies_update on companies
  for update to authenticated
  using (id = current_company_id() and is_company_admin())
  with check (id = current_company_id() and is_company_admin());
create policy companies_insert on companies
  for insert to authenticated
  with check (is_platform_admin());

-- Everyone sees their own company's roster; admins manage it. A platform
-- admin may seed the first membership of a company.
create policy memberships_read on memberships
  for select to authenticated
  using (company_id = current_company_id());
create policy memberships_write on memberships
  for all to authenticated
  using (company_id = current_company_id() and is_company_admin())
  with check (company_id = current_company_id() and is_company_admin());
create policy memberships_bootstrap on memberships
  for insert to authenticated
  with check (is_platform_admin());

-- Tenant tables: one policy shape, applied identically. `using` filters reads
-- and updates; `with check` stops a client stamping someone else's company_id.
do $$
declare t text;
begin
  foreach t in array array['projects','floors','units','windows','photos','exports'] loop
    execute format(
      'create policy %I on %I for all to authenticated
         using (company_id = current_company_id())
         with check (company_id = current_company_id())', t || '_tenant', t);
  end loop;
end $$;

grant select, insert, update, delete
  on companies, memberships, projects, floors, units, windows, photos, exports
  to authenticated;

-- ---------------------------------------------------------------------------
-- Applied and verified 2026-08-31 against project ucvvxgussmnyuaexaaxj.
--
-- Isolation proven by impersonating PostgREST (set role authenticated +
-- request.jwt.claims) with two seeded companies:
--   * each admin resolved only their own company and saw only their own rows
--   * a rival reading another company's project BY EXACT ID got 0 rows
--   * inserting a row stamped with another company's id RAISED
--     "new row violates row-level security policy" (the with-check test)
--   * reparenting another company's row into their own changed nothing
--   * a signed-in user with no membership read 0 rows from every table
--   * soft-deleting a membership locked that user out on the NEXT request,
--     which is the property the live lookup exists to provide
-- Anon holds no table grant at all (revoked above), so RLS is not the only
-- thing standing between the public and tenant data.
-- Test rows were deleted afterwards; the database is empty and ready for the
-- real data migration.
