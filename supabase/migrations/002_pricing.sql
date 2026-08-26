-- Job money: locked contract + extras rates on projects, billable removal
-- counts on units. See docs/superpowers/plans/2026-08-21-job-money-plan.md
-- and ProjectPricing / Unit.removed in lib/types.ts.
--
-- DEPLOYED 2026-08-21 to the HyperFocus Supabase project (lmrtferwbyqpfhomtieu),
-- `blinds` schema — same shared-database setup as 001_init.sql.
--
-- Both columns follow the floors.defaults pattern: extra fields on existing
-- tables so the rows ride the existing sync with no new table, outbox kind,
-- or RLS policy. pricing stays nullable — null means the feature was never
-- set up for that project and the UI shows nothing.

alter table blinds.projects
  add column if not exists pricing jsonb;

alter table blinds.units
  add column if not exists removed integer not null default 0
  check (removed >= 0);
