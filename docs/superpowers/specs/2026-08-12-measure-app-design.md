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
- Floors: add floors by number/name (e.g. "L4"). Per-floor defaults, set once, shown as a bar inside the floor and applied to every window:
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
- **floors**: project_id, label, defaults (json: roll, drive, tight, extra_note, d_value, color_codes)
- **units**: floor_id, number, status (active | na | done), sort_order
- **windows**: unit_id, tag_base (LR/BR/…), tag_index (int, 0 = unnumbered), width (stored in SIXTEENTHS as int — no float drift, preserves raw laser readings), height (sixteenths), control_override (null | L | R), deduct (null | Dl | Dr | D), longer_chain (bool), note (text), sort_order

Width/height stored as integer sixteenths of an inch (74 7/8 → 1198; 74 13/16 → 1197). Rounded DOWN to the nearest eighth and converted to decimal only at display/export, so raw 1/16 laser readings survive in the data.

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
| G3–G6 | Fabric color codes from floor defaults (Bed/Liv/Studio/Kitchen) |
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

- More than two users, roles, billing.
- Single-house building type (add later as a chip-set variant).
- Photos of windows.
- Install-phase features (work orders, completion tracking) — this is measurement only.
- Editing exported files round-trip (export is one-way).
