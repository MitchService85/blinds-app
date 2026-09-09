-- The PM view shows that a unit needs a revisit (install_blocked) but never
-- why: factory and measure errors stay internal. Only the boolean crosses.
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
            -- the fact, never the reason: no note, no fault, no issue text
            'blocked', coalesce(u.install_blocked, false),
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
      ) order by nullif(regexp_replace(f.label, '\D', '', 'g'), '')::int nulls last, f.label)
      from floors f where f.project_id = p.id and not f.deleted), '[]'::jsonb)
  ) into result
  from projects p where p.id = s.project_id and not p.deleted;

  return result;
end;
$$;
