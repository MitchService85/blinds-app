-- A window's own measure convention.
--
-- tight_override is a boolean, so it could say tight or "don't note this one"
-- but had no way to say FINISHED: a finished window on a tight floor was
-- unrepresentable. That was assumed never to happen ("no job has yet mixed
-- finished windows into a tight floor"); a job in September 2026 mixed them
-- and the crew found no Finished option on the window at all.
--
-- Four states, mirroring how the floor already carries measure alongside the
-- legacy tight boolean: null inherits the floor, 'tight' and 'finished' are
-- the factory's two conventions, 'none' is an explicit "don't note this one".
-- tight_override stays and is still written in step, so a phone on an older
-- bundle keeps reading tight windows correctly.
alter table windows add column if not exists measure_override text
  check (measure_override is null or measure_override in ('tight', 'finished', 'none'));
