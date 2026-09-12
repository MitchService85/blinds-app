-- Site trips, for invoicing.
--
-- Attached to the project, not a floor: a trip is a van arriving at a
-- building and one visit routinely covers several batches. floors.trips has
-- existed since 001 and was never filled in on a single floor of any job —
-- the shape did not match the work. It stays for old rows; nothing reads it
-- for money any more.
create table if not exists trips (
  id uuid primary key,
  updated_at timestamptz not null default now(),
  synced_at timestamptz not null default now(),
  deleted boolean not null default false,
  company_id uuid not null references companies (id) on delete cascade,
  project_id uuid not null references projects (id) on delete cascade,
  -- A calendar date, not a timestamp: what matters is which day the van
  -- went, and a timestamp would drag timezones into a number read off a
  -- calendar.
  date date not null,
  purpose text not null default 'other' check (purpose in ('measure','install','revisit','other')),
  -- A return visit to fix our own error is still worth logging — it is what
  -- the mistake cost — but the customer does not pay for it.
  billable boolean not null default true,
  note text not null default ''
);

create index if not exists trips_project_idx on trips (project_id);
create index if not exists trips_sync_idx on trips (company_id, updated_at, id);
create index if not exists trips_synced_idx on trips (company_id, synced_at, id);

drop trigger if exists trips_stamp_synced_at on trips;
create trigger trips_stamp_synced_at before insert or update on trips
  for each row execute function stamp_synced_at();

alter table trips enable row level security;

-- Same single-policy shape as every other tenant table: a company sees and
-- writes only its own rows, and cannot stamp a row with anyone else's id.
drop policy if exists trips_all on trips;
create policy trips_all on trips
  for all
  using (company_id = current_company_id())
  with check (company_id = current_company_id());
