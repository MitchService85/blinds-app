-- Project manager view (docs/superpowers/specs/2026-09-06-pm-view-design.md).
-- Applied to project ucvvxgussmnyuaexaaxj.

-- One row per link handed to an external PM. The token is stored in the
-- clear so the crew can re-copy the link (company-scoped by RLS like all
-- tenant data). revoked_at set = link dead on the next request.
create table if not exists project_shares (
  id uuid primary key default gen_random_uuid(),
  updated_at timestamptz not null default now(),
  deleted boolean not null default false,
  company_id uuid not null references companies (id) on delete cascade,
  project_id uuid not null references projects (id) on delete cascade,
  token text not null unique,
  -- who holds it, e.g. "Pentacon PM"; printed as raised_by on deficiencies
  label text not null default '',
  revoked_at timestamptz,
  last_used_at timestamptz
);

-- The customer's complaint, in their words. Not a reuse of the per-blind
-- issue fields: those are our fault attribution and billing data.
create table if not exists deficiencies (
  id uuid primary key default gen_random_uuid(),
  updated_at timestamptz not null default now(),
  deleted boolean not null default false,
  company_id uuid not null references companies (id) on delete cascade,
  project_id uuid not null references projects (id) on delete cascade,
  unit_id uuid not null references units (id) on delete cascade,
  window_id uuid references windows (id) on delete set null,
  share_id uuid references project_shares (id) on delete set null,
  note text not null default '',
  raised_by text not null default '',
  raised_at timestamptz not null default now(),
  status text not null default 'open',
  resolved_at timestamptz,
  constraint deficiencies_status_known check (status in ('open', 'resolved'))
);

create index if not exists project_shares_sync_idx on project_shares (company_id, updated_at, id);
create index if not exists deficiencies_sync_idx on deficiencies (company_id, updated_at, id);
create index if not exists deficiencies_unit_idx on deficiencies (unit_id, status);

alter table project_shares enable row level security;
alter table deficiencies enable row level security;

drop policy if exists project_shares_tenant on project_shares;
create policy project_shares_tenant on project_shares
  for all to authenticated
  using (company_id = current_company_id())
  with check (company_id = current_company_id());

drop policy if exists deficiencies_tenant on deficiencies;
create policy deficiencies_tenant on deficiencies
  for all to authenticated
  using (company_id = current_company_id())
  with check (company_id = current_company_id());

grant select, insert, update, delete on project_shares, deficiencies to authenticated;

-- ---------------------------------------------------------------------------
-- The two functions an anonymous PM can call. The token is the whole
-- authorisation; an unknown or revoked one returns nothing at all.
-- ---------------------------------------------------------------------------

create or replace function pm_project_status(share_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  s project_shares%rowtype;
  result jsonb;
begin
  if coalesce(share_token, '') = '' then return null; end if;

  select * into s from project_shares
  where token = share_token and not deleted and revoked_at is null;
  if not found then return null; end if;

  update project_shares set last_used_at = now() where id = s.id;

  -- Minimal by construction: no sizes, no notes, no blocked/staged, no money.
  select jsonb_build_object(
    'project', jsonb_build_object('name', p.name, 'address', p.address),
    'label', s.label,
    'floors', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', f.id,
        'label', f.label,
        'units', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', u.id,
            'number', u.number,
            'done', coalesce(u.install, '') = 'done',
            'windows', coalesce((
              select jsonb_agg(jsonb_build_object(
                'id', w.id, 'tag_base', w.tag_base, 'sort_order', w.sort_order)
                order by w.sort_order)
              from windows w where w.unit_id = u.id and not w.deleted), '[]'::jsonb),
            'deficiencies', coalesce((
              select jsonb_agg(jsonb_build_object(
                'id', d.id, 'window_id', d.window_id, 'note', d.note,
                'status', d.status, 'raised_at', d.raised_at)
                order by d.raised_at)
              from deficiencies d
              where d.unit_id = u.id and not d.deleted and d.share_id = s.id), '[]'::jsonb)
          ) order by u.sort_order, u.number)
          from units u where u.floor_id = f.id and not u.deleted and u.status <> 'na'), '[]'::jsonb)
      -- Natural order: "Level 2" before "Level 10"; labels with no number last.
      ) order by nullif(regexp_replace(f.label, '\D', '', 'g'), '')::int nulls last, f.label)
      from floors f where f.project_id = p.id and not f.deleted), '[]'::jsonb)
  ) into result
  from projects p where p.id = s.project_id and not p.deleted;

  return result;
end;
$$;

create or replace function pm_flag_deficiency(
  share_token text,
  target_unit uuid,
  target_window uuid,
  complaint text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  s project_shares%rowtype;
  u units%rowtype;
  new_id uuid;
  body text := left(btrim(coalesce(complaint, '')), 1000);
begin
  if coalesce(share_token, '') = '' or body = '' then return null; end if;

  select * into s from project_shares
  where token = share_token and not deleted and revoked_at is null;
  if not found then return null; end if;

  -- The unit must be on THIS share's project; the caller's ids prove nothing.
  select u2.* into u from units u2
  join floors f on f.id = u2.floor_id
  where u2.id = target_unit and not u2.deleted and f.project_id = s.project_id;
  if not found then return null; end if;

  if target_window is not null and not exists (
    select 1 from windows w where w.id = target_window and w.unit_id = u.id and not w.deleted
  ) then
    return null;
  end if;

  insert into deficiencies (company_id, project_id, unit_id, window_id, share_id, note, raised_by)
  values (s.company_id, s.project_id, u.id, target_window, s.id, body, s.label)
  returning id into new_id;

  update project_shares set last_used_at = now() where id = s.id;
  return new_id;
end;
$$;

revoke execute on function pm_project_status(text), pm_flag_deficiency(text, uuid, uuid, text) from public;
grant execute on function pm_project_status(text), pm_flag_deficiency(text, uuid, uuid, text) to anon, authenticated;
