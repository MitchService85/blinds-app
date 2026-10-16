-- Deficiency fix batches: the flagged blinds on chosen floors, gathered into
-- one list the crew works down on site and bills from.
--
-- Two tables rather than a jsonb list on the batch: two installers ticking
-- off fixes on two phones must not overwrite each other, and sync is
-- last-write-wins per row.
create table if not exists fix_batches (
  id uuid primary key,
  updated_at timestamptz not null default now(),
  synced_at timestamptz not null default now(),
  deleted boolean not null default false,
  company_id uuid not null references companies (id) on delete cascade,
  project_id uuid not null references projects (id) on delete cascade,
  name text not null default '',
  floor_ids uuid[] not null default '{}',
  -- Charge per fix (one panel), integer cents. Null until someone sets it.
  rate_cents integer,
  created_at timestamptz not null default now()
);

-- window_id / unit_id / floor_id deliberately carry no foreign key: a fix
-- that has been billed must survive its blind being deleted or re-measured.
create table if not exists fix_items (
  id uuid primary key,
  updated_at timestamptz not null default now(),
  synced_at timestamptz not null default now(),
  deleted boolean not null default false,
  company_id uuid not null references companies (id) on delete cascade,
  batch_id uuid not null references fix_batches (id) on delete cascade,
  project_id uuid not null references projects (id) on delete cascade,
  floor_id uuid not null,
  unit_id uuid not null,
  window_id uuid not null,
  unit_number text not null default '',
  blind_label text not null default '',
  panels integer not null default 1,
  problem text not null default '',
  fault text check (fault in ('factory','measure')),
  recut boolean not null default false,
  unit_was_blocked boolean not null default false,
  status text not null default 'open' check (status in ('open','fixed','cant')),
  fix_note text not null default '',
  qty integer not null default 1,
  billable boolean not null default true,
  fixed_at timestamptz,
  invoice_id uuid,
  sort_order integer not null default 0
);

create index if not exists fix_batches_project_idx on fix_batches (project_id);
create index if not exists fix_batches_synced_idx on fix_batches (company_id, synced_at, id);
create index if not exists fix_items_batch_idx on fix_items (batch_id);
create index if not exists fix_items_synced_idx on fix_items (company_id, synced_at, id);

drop trigger if exists fix_batches_stamp_synced_at on fix_batches;
create trigger fix_batches_stamp_synced_at before insert or update on fix_batches
  for each row execute function stamp_synced_at();
drop trigger if exists fix_items_stamp_synced_at on fix_items;
create trigger fix_items_stamp_synced_at before insert or update on fix_items
  for each row execute function stamp_synced_at();

alter table fix_batches enable row level security;
alter table fix_items enable row level security;

drop policy if exists fix_batches_all on fix_batches;
create policy fix_batches_all on fix_batches
  for all
  using (company_id = current_company_id())
  with check (company_id = current_company_id());

drop policy if exists fix_items_all on fix_items;
create policy fix_items_all on fix_items
  for all
  using (company_id = current_company_id())
  with check (company_id = current_company_id());
