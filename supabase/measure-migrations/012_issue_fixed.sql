-- A fixed blind keeps its issue as the record and says when and how it was
-- fixed, instead of the issue being wiped (Mitch, 2026-10-23: "the issue
-- still shows, so we have it to track, but we can show that we have
-- addressed the deficiency"). issue_fixed_at set = no longer open.
alter table windows add column if not exists issue_fixed_at timestamptz;
alter table windows add column if not exists issue_fix_note text not null default '';
