-- Per-blind install issues (field request, 2026-08-27): when a unit's
-- install is blocked, the crew records which individual blinds are wrong,
-- whose error it is, and whether a recut is needed — the factory pays for
-- recuts caused by factory error, so the attribution is the billing record.
-- Punch-list data like units.note; never exported to the measure workbook.

alter table blinds.windows
  add column if not exists issue_note text not null default '',
  add column if not exists issue_fault text
    check (issue_fault is null or issue_fault in ('factory', 'measure')),
  add column if not exists issue_recut boolean not null default false;
