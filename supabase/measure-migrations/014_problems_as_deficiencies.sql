-- One row per problem (Mitch, 2026-10-23: "we complete 'needs 1/8 cut off',
-- then add 'stain on blind, needs replacement' later — those should be two
-- separate completable deficiencies"). The crew's problems become deficiency
-- rows beside the PM's, with our own fault / recut / what-was-done fields.
-- The PM view returns only deficiencies raised through that PM's link, and
-- never these columns.

-- Part 1: columns (run before the app that writes them ships).
alter table deficiencies add column if not exists fault text check (fault in ('factory', 'measure'));
alter table deficiencies add column if not exists recut boolean not null default false;
alter table deficiencies add column if not exists fix_note text not null default '';
alter table fix_items add column if not exists deficiency_id uuid;

-- Part 2: move the windows' single-issue fields into deficiency rows (run
-- after the app that reads them ships). The id is derived from the issue
-- itself — the same formula as lib/issues.ts legacyIssueId — so a phone that
-- moves the same issue writes the same row, not a second one.
insert into deficiencies (id, updated_at, deleted, company_id, project_id, unit_id, window_id, share_id,
                          note, raised_by, raised_at, status, resolved_at, fault, recut, fix_note)
select
  substr(encode(sha256(convert_to('legacy-issue:' || w.id::text || ':' || coalesce(w.issue_note, '') || ':' ||
    coalesce(w.issue_fault, '') || ':' || coalesce(w.issue_recut, false)::text, 'UTF8')), 'hex'), 1, 32)::uuid,
  now(), false, w.company_id, f.project_id, u.id, w.id, null,
  coalesce(w.issue_note, ''), 'Crew', w.updated_at,
  case when w.issue_fixed_at is null then 'open' else 'resolved' end,
  w.issue_fixed_at, w.issue_fault, coalesce(w.issue_recut, false), coalesce(w.issue_fix_note, '')
from windows w
join units u on u.id = w.unit_id
join floors f on f.id = u.floor_id
where not w.deleted
  and (coalesce(trim(w.issue_note), '') <> '' or w.issue_fault is not null or coalesce(w.issue_recut, false))
on conflict (id) do nothing;

-- Fix-batch entries point at the problem they fix.
update fix_items i set deficiency_id = substr(encode(sha256(convert_to('legacy-issue:' || w.id::text || ':' ||
    coalesce(w.issue_note, '') || ':' || coalesce(w.issue_fault, '') || ':' || coalesce(w.issue_recut, false)::text,
    'UTF8')), 'hex'), 1, 32)::uuid,
  updated_at = now()
from windows w
where w.id = i.window_id and i.deficiency_id is null
  and (coalesce(trim(w.issue_note), '') <> '' or w.issue_fault is not null or coalesce(w.issue_recut, false));

-- And the windows' fields are emptied, so nothing reads them twice.
update windows set issue_note = '', issue_fault = null, issue_recut = false, issue_fixed_at = null,
  issue_fix_note = '', updated_at = now()
where not deleted
  and (coalesce(trim(issue_note), '') <> '' or issue_fault is not null or coalesce(issue_recut, false));
