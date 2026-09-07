# Project manager view

An external project manager — the GC's or Elite's, not one of ours — needs
two things from a job: is each unit done, and a way to say when something is
wrong. Nothing else. Not sizes, not notes, not who is blocked on what, and
never money.

## Who the PM is

Not a user. They have no account, get no code by email, and are not on the
company's team. They hold a **link**, one per project they are assigned to,
and the link is the whole authorisation — the same model as a Drive share.
A PM on two of our jobs holds two links. Revoking a link is one tap and
takes effect on their next request.

Rejected: a `pm` membership role. Members resolve to a company and read
through the tenant policies; hiding pricing, notes and sizes from one role
means column-level exceptions in every policy, and the PM would still need
to sign in. The PM is not in the tenant; the design should say so.

## How the link works

`project_shares` holds the token in the clear, company-scoped by the same
tenant policy as everything else, so the crew can re-copy a link from the
project screen instead of being shown it once. A capability URL that can be
re-read is what a share link *is*; the token is 32 random bytes, and a
database compromise that read it would already have read the measurements.

The anon role holds no table grant at all (001). It gets EXECUTE on exactly
two security-definer functions:

- `pm_project_status(token)` → the project's name and address, its floors,
  and for each non-N/A unit: number, whether install is done, its window
  labels (tag + index only, no dimensions), and the deficiencies raised
  through *this* share. Nothing about blocked, staged, notes, or issues.
- `pm_flag_deficiency(token, unit_id, window_id, note)` → inserts one row,
  stamping company and project **from the share**, never from the caller,
  after checking the unit belongs to the project and the window (if any)
  belongs to the unit. Note length is capped.

Both return nothing at all for an unknown or revoked token. The linter will
flag them as anon-callable security-definer functions; that is the design,
and the token check on the first line is why it is safe.

## Deficiencies

Their own table, not a reuse of per-blind issues: those are *our* fault
attribution (factory vs measure, recut or not) and are billing data. A
deficiency is the customer's complaint, in their words, with who raised it
and whether we have dealt with it.

`deficiencies` is an ordinary tenant table. The PM writes through the
function; the crew reads it through sync like any other row and resolves it
with a normal write. It surfaces wherever the crew already looks: a count
on the dashboard strip, a line on the job card, a panel on the floor screen,
and the list on the unit screen with a Resolve button.

## The PM screen

`/pm/[token]`, no sign-in, no local database. It fetches once, renders a
unit grid (done / not done), and lets the PM tap a unit to see its window
labels and write a deficiency against the unit or one window. The form is in
the page, not in a fixed overlay (components/keyboard.tsx). Their own open
deficiencies show under the unit so they can see we received it.
