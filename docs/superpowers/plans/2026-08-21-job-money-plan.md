# Plan — Job Money: locked contract, extras, invoice summary

Spec: this document (self-contained). Companion to
`docs/superpowers/specs/2026-08-12-measure-app-design.md`, which stays
authoritative for the measure/export core.

## How the money actually works (Mitch, 2026-08-21)

Danny (Mike's father-in-law) gets the contracts through Elite. He counts
windows off the floor plans, knows rough sizing, and sets the price — **the
quote is locked before the crew ever measures**. Mitch and Mike then measure
actuals on site. So the app must NOT generate quotes; it must track a job
whose price is already fixed:

1. **Record the locked contract** — Danny's number and his quoted blind count.
2. **Catch variance** — the app knows the real count the moment measures go
   in (Four Seasons: 98 blinds known on entry day). If actuals beat Danny's
   plan-takeoff count, that's a change-order conversation *before* install,
   not a surprise after.
3. **Bill the extras** — the crew's own billables on top of the contract:
   removal of old blinds, install labor, motorized premium, trip charges.
   Floor `order_number` + `trips` already exist as invoicing inputs (Mike);
   this closes the loop.
4. **Invoice summary** — subtotal + 13% HST + total, on-screen for a fast
   answer on site AND exportable as a file (Mitch: "Both").

## Data model

All money in **integer cents** (same philosophy as integer sixteenths — no
floats in stored data).

- `projects.pricing` jsonb (nullable → feature invisible until set), mirroring
  the `floors.defaults` pattern so it rides existing row sync with no new
  table, outbox kind, or pull path:
  ```
  {
    contract_cents:        number | null,  // Danny's locked price
    quoted_blind_count:    number | null,  // Danny's plan takeoff
    removal_per_blind_cents:   number | null,  // null = not billed
    install_per_blind_cents:   number | null,
    motorized_premium_cents:   number | null,  // per motorized blind
    trip_charge_cents:         number | null,  // per recorded trip
    note: string                          // e.g. "install billed to Elite net 30"
  }
  ```
  Rate `null` = line item off. Whole-row LWW on projects is acceptable: same
  trade-off already accepted for `floors.defaults`.
- `units.removed` integer default 0 — old blinds taken down in that
  unit/zone. Field reality is per side/unit (Four Seasons: 36/13/36/13 per
  side); floors and project roll up by summing. Today this lives in free-text
  notes; the note habit stays valid, the field makes it billable.
- Supabase `migrations/002_pricing.sql`: `alter table blinds.projects add
  column pricing jsonb`, `alter table blinds.units add column removed integer
  not null default 0`. Dexie version bump with no data transform (new fields
  are optional). Sync normalisation defaults `removed` to 0 for rows from
  older phones, same as `blind_count` is defaulted in `lib/sync/index.ts`.

## Math (`lib/pricing.ts`, pure functions + unit tests)

- **Actual blinds** = Σ panels × quantity over non-deleted windows of active
  units — same definition as `countBlinds` in the exporter and the unit-tile
  counts (Cleveland L12: 1 opening, 13 blinds). Reuse, don't re-derive.
- **Motorized blinds** = blinds whose window resolves motorized
  (`motorized_override ?? floor.defaults.motorized`).
- **Removed** = Σ `units.removed`; **Trips** = Σ `floors.trips`.
- **Invoice lines** (each only when its rate is non-null):
  contract; removal × rate; install × actual blinds × rate; motorized premium
  × motorized blinds; trip charge × trips. Subtotal → HST 13% → total.
  HST rate is a named constant with a comment, not a magic number.
- **Variance** = actual blinds − quoted_blind_count (when quoted set):
  displayed as "+2 over quote" / "3 under quote".

## UI

- **Project screen — Money card.** Hidden until pricing is set ("Add
  pricing" affordance). Shows contract, computed extras, subtotal, HST,
  total; variance badge (over-quote = the warning treatment already used for
  measurement checks — it's the same "flag before it costs us" idea).
  Editing via a sheet styled after `floor-defaults-form.tsx`: dollar keypad
  entry, cents under the hood.
- **Unit screen — removed count.** Small stepper/keypad field beside the
  existing status controls. Not exported to the factory sheet (like `note`).
- **Floor screen** keeps `order_number`/`trips` where they are; trips now
  visibly feed the Money card.

## Invoice export

- "Invoice summary" .xlsx built with the existing exceljs plumbing
  (`lib/export/shared.ts` patterns): header (project name, address, order
  numbers), one row per line item, subtotal/HST/total, per-floor blind
  counts appendix. Golden-file test with a fixture project, mirroring the
  factory-export test approach.
- Not wired into export history v1 — history/diff stays a factory-order
  concern. Revisit if invoices start getting re-sent.

## Phases

1. **Data + math** — types, Dexie bump, `002_pricing.sql`, sync
   normalisation, `lib/pricing.ts` with tests (incl. rate-off lines, null
   quoted count, rounding at the HST line). `npm run build` + tests green.
2. **UI** — Money card + pricing sheet on project screen; removed stepper on
   unit screen; variance badge. Verified in browser at 375px.
3. **Invoice export** — workbook builder + golden-file test; share/download
   from the Money card. Deploy, then enter real numbers for Four Seasons as
   the first live job.

## Open questions (for Mitch/Danny — none block Phase 1)

- Is install labor billed on top of Danny's contract, or already inside it?
  (Model supports either: leave the rate null if it's inside.)
- Who receives the invoice file — Elite/Danny or the building? Affects only
  the header block wording/branding, not the math.
- Does Danny's quote ever break out per floor? If yes, quoted counts could
  move to floors later; project-level is enough for v1.
