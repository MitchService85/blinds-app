# Blinds Measurement App — Design

Date: 2026-08-12
Status: Draft for review
Users: Mitch + Mike (single shared workspace)

## Purpose

Replace Apple Notes for recording blind measurements on job sites. Contractor-grade data entry on a phone: fast, gloved-thumb friendly, survives zero reception, and exports the factory spreadsheet exactly as produced for Arbour House Level 4.

## Platform and stack

- **PWA** (installable from the browser, works on iPhone and Android). No App Store.
- **Next.js on Vercel** (deploy from CLI, same as other projects).
- **Supabase** (Postgres) as the cloud store; **IndexedDB** on the phone as the primary write target.
- **exceljs** in the browser for export, so exporting works offline.
- Service worker for offline shell. Includes an update banner when a new version is deployed (lesson from HyperFocus: silently stale PWA caches cause "my fix isn't there").

## Auth

Supabase magic-link email sign-in, once per device; both emails allowlisted (ms@mitchservice.com + Mike's). Sessions persist for months. RLS restricts all tables to the two allowlisted users. No sign-up flow, no passwords.

## Screens

### 1. Dashboard
- Job cards: name, address, building type, per-floor progress chips (L2 done, L5 12/29), sync status line.
- "+ New" opens the new-job wizard.

### 2. New job wizard
- Name, address.
- Building type: **Multi-unit residential** or **Office/commercial**. Both use the same hierarchy (building → floor → unit → window); the type sets terminology and the default room-tag chip set:
  - Residential: LR, BR, MBR, Kit, Studio, Den, Bath
  - Commercial: Office, Boardroom, Reception, Kitchen, Corridor
  - Chip set is editable per project (add/remove tags).
- Floors: add groups by number/name — a physical floor ("L4") or an arbitrary batch of units scattered around the building ("Batch 3", as in 44 Charles). Per-floor defaults, set once, shown as a bar inside the floor and applied to every window:
  - Roll: Reverse (checkbox → "Rev" in export)
  - Drive/control default: Right or Left
  - Tight measures (checkbox)
  - Extra note applied to all windows (e.g. "DRILL HOLES IN FASCIA")
  - D value (default 1/2)
  - Fabric color codes for the header block (Bed/Liv/Studio/Kitchen), optional.

### 3. Floor view
- Defaults bar (tap to edit).
- Unit grid: numbered tiles, color-coded — not started / in progress / done / N/A (struck through). Long-press or menu to mark a unit N/A or done. "+" adds a unit (prefilled next number, editable).
- Save & exit + Export buttons.

### 4. Unit view / window entry (the core screen)
One window at a time:
- **Panels**: a window holds 1..n panel widths (bay windows: side/centre/side) sharing one tag, height, and options. "+ panel" adds a width field; export emits one row per panel with the repeated tag (matches 44 Charles Batch 3).
- Room chips (from project chip set). Tapping LR when an LR exists auto-numbers: LR → LR1, LR2… (matches 401-LR1 convention; first window keeps plain tag until a second of the same type is added, then both get numbered — export renames retroactively so numbering is always consistent).
- Width and Height: whole-inch number pad plus a **fraction row**. No free typing needed; keyboard never opens.
- **Precision switch (⅛ / ¹⁄₁₆) on the keypad**, persisted per device: in 1/16 mode (laser measure) the fraction row shows sixteenths; the entered value is auto-rounded DOWN to the nearest 1/8 for display and export, with the raw laser reading shown as a hint (“74 3/4 — from 74 13/16”) and kept in storage.
- Height remembers the last value used for that room type on this floor (heights repeat constantly: 87 / 63).
- Option checkboxes (large tap targets):
  - Deduct: Left / Right / Both (mutually exclusive; exports Dl / Dr / D)
  - Left control (overrides floor default; exports L in Control)
  - Longer chain
  - Note (opens small text field for one-offs, e.g. corner reductions)
- "Save · next window" advances within the unit. Windows list for the unit visible below for review/edit/delete.
- Every field change writes to IndexedDB immediately (see Autosave).

### 5. Export
- Pick floor → generates `{Project Name} - {Floor}.xlsx` → phone share sheet (AirDrop, email, Files).
- Works offline; sync status does not gate export.

## Data model

Postgres (Supabase) and IndexedDB share the same shape. All rows carry `id (uuid)`, `updated_at`, `deleted (bool)` for sync.

- **projects**: name, address, building_type, tag_chips (json)
- **floors**: project_id, label, defaults (json: roll, drive, tight, mount, motorized, chain_type, extra_note, d_value, color_codes {mbed, liv, bed, kit})
- **units**: floor_id, number, status (active | na | done), sort_order
- **exports**: floor_id, exported_at, filename, blind_count, input (jsonb snapshot of ExportInput)
- **windows** also carry: quantity, mount_override, tight_override, chain_length, motorized_override, panel_controls (per-panel control side, residential bays), checks_ack (warnings dismissed for this window)
- **windows**: unit_id, tag_base (LR/BR/…), tag_index (int, 0 = unnumbered), width (stored in SIXTEENTHS as int — no float drift, preserves raw laser readings), height (sixteenths), control_override (null | L | R), deduct (null | Dl | Dr | D), longer_chain (bool), note (text), sort_order

Width/height stored as integer sixteenths of an inch (74 7/8 → 1198; 74 13/16 → 1197). Rounded DOWN to the nearest eighth and converted to decimal only at display/export, so raw 1/16 laser readings survive in the data.

## Install mode (added 2026-08-13, Mitch-approved)

Floor view gains a Measure | Install toggle. Install lens per unit: install = null → "staged" (🟢 dropped off/handoff-ready) → "done" (✅), both steps optional (solo installs jump to done); install_blocked (⚠️ yellow) is an independent flag requiring a unit note, overrides display until cleared. Tap = action sheet (Staged/Complete/Blocked/Clear + Open unit). Counts in header; blocked notes listed; dashboard chips show install line once a floor has activity. Rides on unit rows — syncs, offline, never exported.

## Mount types (added 2026-08-20, from the Drive corpus survey)

Floor defaults carry a mount (Not noted / Inside tight / Inside / Outside) replacing the tight checkbox; each window can override it (20 Victoria mixes Tight and Finished on one floor). Exports write the corpus wording — "TIGHT MEASURES" / "Inside Mount" / "Outside Mount" — as the leading Notes text. The legacy `tight` boolean is kept in sync for older clients.

## Export history (added 2026-08-18)

Every export snapshots the `ExportInput` that produced it into a synced `exports`
row, not the .xlsx bytes. `buildWorkbook` is pure, so the snapshot both
regenerates the byte-identical workbook on demand and supports a structural
diff against the next export. Bytes would only reveal *that* something changed.

- **Review before exporting.** Warnings (lib/checks.ts) and changes since the
  last export appear together in one sheet, never as consecutive prompts.
  Neither blocks: the sheet always offers Export.
- **Floor-level changes are called out separately.** A D value going from 1/2
  to 1/4 rewrites the finished size of every blind while touching one header
  cell, so `diffExports` compares defaults (D value, mount, roll, control side,
  floor note, colour codes) as well as windows.
- **Windows match by row id**, carried in the snapshot via optional `id` fields
  the workbook builder ignores, so reordering is not a change. Older snapshots
  without ids fall back to unit + tag + ordinal.
- **Units marked N/A count as removed**, matching what the workbook emits.
- **Recorded on generation, not on send.** The share sheet can be cancelled
  and we cannot detect it, so the history says "Exported", never "Sent".
- **History is re-downloadable**: each entry regenerates its own file, so
  "what did we send on the 12th?" returns that file, not today's.
- No backfill for exports predating this feature, and no cap on history depth.

Structural note: the pure conventions (shapes, tag labels, mount wording,
deduct placement, round-down-to-eighth) live in `lib/export/shared.ts`, free of
any ExcelJS import, so the floor screen can diff on every render without
pulling the workbook writer into the bundle. `exporter.ts` re-exports them, and
the golden-file test proved the split byte-safe.

## Motorized, chain length, and the mount/tight split (2026-08-18)

Built from what the corpus actually records, not from the field names.

- **Chain length** (`windows.chain_length`, whole inches) goes into the
  template's Chain column, which its own Instructions sheet defines as "Chain
  length value (e.g., 72, 48, 60)". Across 19 order files and 1,166 blind rows
  (Apr-Aug 2026) that column holds a value exactly **twice**, and both are the
  word "Metal" rather than a length. Lengths went into Notes instead
  ("Requires 160\" chain" at Citi), and 53 rows carry the vaguer "LONGER
  CHAIN". (528 is the count of rows saying TIGHT MEASURES, a different figure.) **A window with a chain length exports the
  number and drops "LONGER CHAIN" from its note** (Mitch's call). The legacy
  boolean still works alone, so old rows export unchanged.
- **Chain type** (`floors.defaults.chain_type`, e.g. "Metal") reaches the
  factory through Notes. It cannot use the Chain column, which is reserved for
  a length, and the evidence is two cells at 2000-181 University.
- **Motorized** is a floor default with a per-window override, because the
  corpus records it per zone (Canadian Tire marks "Motorized" on a room header
  covering every size beneath it). Exports as `MOTORIZED` in Notes.
- **Mount and tight are now independent.** Mount (`inside`/`outside`) is where
  the blind sits; tight is how it was measured; a floor or window can be both.
  They were one 4-way control until now, and although the corpus never combines
  them across 579 annotated rows, that was the control's limitation.
  `"inside_tight"` is a legacy stored value meaning only "measured tight" —
  readers normalise it to `{ mount: null, tight: true }` and the DB check still
  accepts it so phones on an older bundle keep syncing. One live floor was
  migrated; zero windows carried any mount override.
- **New check**: motorized *and* a chain length is contradictory, plus chain
  lengths outside 12"–240" are flagged as typos.

Note ordering: `TIGHT MEASURES`, mount, `MOTORIZED`, floor note, window note,
chain type, `LONGER CHAIN`. Tight leads because it does on every accepted file.

## Unit photos (added 2026-08-18, Mitch field request)

Unit notes can carry photos ("here's the issue I mean"). Camera/library via a file input; compressed client-side to a ~1280px JPEG data URL and stored in a synced `photos` row — rides the normal offline-first row sync, so the whole crew sees them. Thumbnails under the note, full-screen viewer with delete.

## Voice entry (built 2026-08-16, REMOVED 2026-08-18)

Dictation-to-form was built (iOS keyboard mic + rule-based parser) and failed its field test: with AirPods in a quiet area it misheard almost everything. Removed at Mitch's request. If revisited, the constraint stands: offline-capable, and never auto-save a heard measurement.

## Seed data

First run loads three real example projects from `fixtures/seed-projects.json` so Mike sees the app populated: Arbour House Level 2 + Level 4, and 44 Charles Batch 3 (48 three-panel bay windows, units scattered across floors). Seeded rows are normal rows — editable, exportable, syncable.

## Autosave and sync

- **Local-first:** UI reads/writes IndexedDB only. A write is durable the moment the tap lands; airplane mode changes nothing about entry.
- **Outbox sync:** every local write also appends to an outbox queue. A background loop drains the outbox to Supabase whenever online (and on app focus / after Save & exit). Pull side: on app open and on interval, fetch rows with `updated_at` newer than last sync.
- **Conflicts:** per-row last-write-wins on `updated_at`. Each window is an independent row and Mitch/Mike split up in a building, so collisions are rare and low-stakes.
- **Deletes** are soft (`deleted = true`) so they sync cleanly.
- **Status indicator**, always visible: "✓ saved" (local) and "✓ synced" / "3 pending" (cloud). Never a spinner blocking entry.
- **Save & exit** = navigate to dashboard + force a sync attempt. It exists for confidence; autosave has already persisted everything.

## Export mapping (must match the Level 4 file exactly)

Template constants baked into the exporter (from the Arbour House template, Instructions-sheet rules + Mike's amendments):

| Cell/col | Content |
|---|---|
| A1:A4 | Standard reference notes |
| G1 | `{Project Name} - {Floor}` |
| G2 | Export date |
| F3–G6 | Fabric color codes from floor defaults, labelled **MBED / LIV / BED / KIT** (Mike's own room designations, which the factory returns labelled the same way). Renamed 2026-08-20: BR and MBR previously shared one "Bed" code so a master bedroom could not take a different fabric. "Studio" was dropped at the same time, nothing in any job is tagged Studio. |
| I7 | `D = {d_value}` |
| Row 9 | Exact headers incl. trailing spaces in `Chain ` and `Deducts ` |
| A (rows 10+) | `{unit}-{tag}` e.g. `401-LR1` |
| D | `Rev` if floor default reverse roll |
| E, F | Width, Height as decimals |
| H (Fabric) | **Always empty** — factory fills it (Mike's rule) |
| I | `L`/`R` (floor default unless overridden) |
| J (Deducts) | `Dl` / `Dr` / `D` |
| K (Notes) | `TIGHT MEASURES. DRILL HOLES IN FASCIA`-style string built from floor defaults (tight + extra note), then any per-window note appended. "LONGER CHAIN" appended when flagged |
| G (Chain ), B (Q), C (Product) | Left empty (matches current practice) |
| Column O | Unused |

Units marked N/A are skipped. Rows ordered by unit number, then window sort order. Instructions sheet copied into the workbook unchanged.

**Golden-file test:** exporter output for the Level 4 data must cell-for-cell match the delivered `Arbour House 15 Neighborhood Lane - Level 4.xlsx` (values, not styling bytes). This is the regression gate for any exporter change.

## Sanity checks (non-blocking)

On marking a unit done and on export, `lib/checks.ts` warns on suspicious entries — v1 rule: 3-panel bay side widths differing by more than 1.5" (validated against real data: catches the known 44 Charles error with zero false positives across all three projects). Warnings list the unit/window and both values; entry and export are never blocked.

## Error handling

- Sync failures retry with backoff; never surface as blocking errors, only the pending count.
- Magic-link session expiry: app keeps working locally, shows a "sign in to sync" banner.
- Width/height of 0 or missing blocks "Save · next" for that window only.
- Duplicate unit numbers on a floor rejected inline.
- Export with zero windows on a floor warns before producing a file.

## Testing

- Unit tests: tag auto-numbering (LR→LR1/LR2 retro-numbering), sixteenths math + round-down-to-eighth, note-string builder, deduct exclusivity.
- Exporter golden-file test against the real Level 4 workbook.
- Manual field test: airplane-mode entry session → reconnect → verify sync and export.

## Out of scope (v1)

- Drapery (Cleveland Clinic has drapery sections in Mike's notes; Mitch hasn't measured drapery before and wants to design that flow later, once he understands it).

- More than two users, roles, billing.
- Single-house building type (add later as a chip-set variant).
- Photos of windows.
- Install-phase features (work orders, completion tracking) — this is measurement only.
- Editing exported files round-trip (export is one-way).
