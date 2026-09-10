-- Pull by the server's clock, not the phone's.
--
-- Rows carry updated_at from the device that wrote them, and last-write-wins
-- is decided on it — correctly, since it is the order the crew actually made
-- their edits in. But the sync PULL paged by that same column, and a device
-- only ever asked for rows newer than the last one it had seen. A row that
-- reached the server LATE with an OLD updated_at (queued on a phone for
-- weeks, pushed once its sync unstuck) was therefore invisible to every
-- device whose watermark had already passed that date: it existed on the
-- server and nobody was told. A from-scratch download surfaced one such row
-- on 2026-09-10 — a stale copy of a whole project, three weeks old, that one
-- phone had never fetched. The same hole would hide a late edit or a late
-- deletion just as quietly.
--
-- synced_at is stamped by the server on every insert and update (the upsert's
-- UPDATE branch included) and is what the pull now pages by; updated_at keeps
-- its job for last-write-wins. Existing rows take the migration time, so every
-- device does one full re-download — the pull's own last-write-wins guard
-- keeps any newer local edit — and from then on nothing arriving late can be
-- missed.

create or replace function stamp_synced_at()
returns trigger
language plpgsql
as $$
begin
  new.synced_at := now();
  return new;
end;
$$;

alter table companies      add column if not exists synced_at timestamptz not null default now();
alter table memberships    add column if not exists synced_at timestamptz not null default now();
alter table projects       add column if not exists synced_at timestamptz not null default now();
alter table floors         add column if not exists synced_at timestamptz not null default now();
alter table units          add column if not exists synced_at timestamptz not null default now();
alter table windows        add column if not exists synced_at timestamptz not null default now();
alter table photos         add column if not exists synced_at timestamptz not null default now();
alter table exports        add column if not exists synced_at timestamptz not null default now();
alter table invoices       add column if not exists synced_at timestamptz not null default now();
alter table project_shares add column if not exists synced_at timestamptz not null default now();
alter table deficiencies   add column if not exists synced_at timestamptz not null default now();

drop trigger if exists companies_stamp_synced_at      on companies;
drop trigger if exists memberships_stamp_synced_at    on memberships;
drop trigger if exists projects_stamp_synced_at       on projects;
drop trigger if exists floors_stamp_synced_at         on floors;
drop trigger if exists units_stamp_synced_at          on units;
drop trigger if exists windows_stamp_synced_at        on windows;
drop trigger if exists photos_stamp_synced_at         on photos;
drop trigger if exists exports_stamp_synced_at        on exports;
drop trigger if exists invoices_stamp_synced_at       on invoices;
drop trigger if exists project_shares_stamp_synced_at on project_shares;
drop trigger if exists deficiencies_stamp_synced_at   on deficiencies;

create trigger companies_stamp_synced_at      before insert or update on companies      for each row execute function stamp_synced_at();
create trigger memberships_stamp_synced_at    before insert or update on memberships    for each row execute function stamp_synced_at();
create trigger projects_stamp_synced_at       before insert or update on projects       for each row execute function stamp_synced_at();
create trigger floors_stamp_synced_at         before insert or update on floors         for each row execute function stamp_synced_at();
create trigger units_stamp_synced_at          before insert or update on units          for each row execute function stamp_synced_at();
create trigger windows_stamp_synced_at        before insert or update on windows        for each row execute function stamp_synced_at();
create trigger photos_stamp_synced_at         before insert or update on photos         for each row execute function stamp_synced_at();
create trigger exports_stamp_synced_at        before insert or update on exports        for each row execute function stamp_synced_at();
create trigger invoices_stamp_synced_at       before insert or update on invoices       for each row execute function stamp_synced_at();
create trigger project_shares_stamp_synced_at before insert or update on project_shares for each row execute function stamp_synced_at();
create trigger deficiencies_stamp_synced_at   before insert or update on deficiencies   for each row execute function stamp_synced_at();

-- The pull pages by (synced_at, id) under RLS's company filter, same shape as
-- the updated_at indexes in 001. companies has no company_id: it IS the tenant.
create index if not exists companies_synced_idx      on companies      (synced_at, id);
create index if not exists memberships_synced_idx    on memberships    (company_id, synced_at, id);
create index if not exists projects_synced_idx       on projects       (company_id, synced_at, id);
create index if not exists floors_synced_idx         on floors         (company_id, synced_at, id);
create index if not exists units_synced_idx          on units          (company_id, synced_at, id);
create index if not exists windows_synced_idx        on windows        (company_id, synced_at, id);
create index if not exists photos_synced_idx         on photos         (company_id, synced_at, id);
create index if not exists exports_synced_idx        on exports        (company_id, synced_at, id);
create index if not exists invoices_synced_idx       on invoices       (company_id, synced_at, id);
create index if not exists project_shares_synced_idx on project_shares (company_id, synced_at, id);
create index if not exists deficiencies_synced_idx   on deficiencies   (company_id, synced_at, id);
