-- Job money: locked contract + extras rates on projects, billable removal
-- counts on units. See docs/superpowers/plans/2026-08-21-job-money-plan.md
-- and ProjectPricing / Unit.removed in lib/types.ts.
--
-- HISTORICAL. Applied 2026-08-21 to the old `blinds` schema inside the
-- HyperFocus project, back when this app shared a database with it.
--
-- Renumbered 002 -> 003 on merge: main had already shipped its own
-- 002_window_issues.sql, and two files claiming 002 is how a migration gets
-- skipped. These files now describe a database the app no longer uses — the
-- app moved to its own `measure` project (ucvvxgussmnyuaexaaxj) on 2026-08-31.
-- The live schema there is supabase/measure-migrations/001_init.sql, which
-- ALREADY carries both of these columns (added during the cutover, precisely
-- because this branch's migration had been applied to the old database and a
-- copy would otherwise have silently dropped them).
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
