-- The PM page says who the link is from ("Pentacon Blinds · install
-- progress", "Shared with Anthony by Pentacon Blinds") and when a report was
-- fixed ("✓ Fixed Oct 24"). Two fields and nothing else: 'company' is the
-- company name on the share's company_id, and 'resolved_at' is added to each
-- of this link's own deficiencies. Everything else is 013 unchanged — still
-- no sizes, no crew notes, no fault / recut / fix_note, no money, and only
-- the deficiencies raised through this link (share_id = s.id), never the
-- crew's. The page treats both fields as optional, so it works before and
-- after this is applied.
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

  select jsonb_build_object(
    'project', jsonb_build_object('name', p.name, 'address', p.address),
    'label', s.label,
    'company', c.name,
    'floors', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', f.id,
        'label', f.label,
        'units', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', u.id,
            'number', u.number,
            'done', coalesce(u.install, '') = 'done',
            'locked', coalesce(u.locked, false),
            -- the fact, never the reason: no note, no fault, no issue text.
            -- Blocked by hand, or installed with a deficiency still open —
            -- a ⚠ on a blind or a PM complaint not yet resolved. Same rule
            -- as the crew's grid (components/status.ts isBlocked).
            'blocked', coalesce(u.install_blocked, false) or (
              u.install is not null and (
                exists (select 1 from windows w where w.unit_id = u.id and not w.deleted
                  and w.issue_fixed_at is null
                  and (coalesce(trim(w.issue_note), '') <> '' or w.issue_fault is not null
                       or coalesce(w.issue_recut, false)))
                or exists (select 1 from deficiencies d where d.unit_id = u.id
                  and not d.deleted and d.status = 'open'))),
            'windows', coalesce((
              select jsonb_agg(jsonb_build_object(
                'id', w.id, 'tag_base', w.tag_base, 'sort_order', w.sort_order)
                order by w.sort_order)
              from windows w where w.unit_id = u.id and not w.deleted), '[]'::jsonb),
            'deficiencies', coalesce((
              select jsonb_agg(jsonb_build_object(
                'id', d.id, 'window_id', d.window_id, 'note', d.note,
                'status', d.status, 'raised_at', d.raised_at,
                'resolved_at', d.resolved_at)
                order by d.raised_at)
              from deficiencies d
              where d.unit_id = u.id and not d.deleted and d.share_id = s.id), '[]'::jsonb)
          ) order by u.sort_order, u.number)
          from units u where u.floor_id = f.id and not u.deleted and u.status <> 'na'), '[]'::jsonb)
      ) order by nullif(regexp_replace(f.label, '\D', '', 'g'), '')::int nulls last, f.label)
      from floors f where f.project_id = p.id and not f.deleted), '[]'::jsonb)
  ) into result
  from projects p
  left join companies c on c.id = s.company_id
  where p.id = s.project_id and not p.deleted;

  return result;
end;
$$;
