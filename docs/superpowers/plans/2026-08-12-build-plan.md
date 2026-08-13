# Build Plan — Blinds Measurement PWA

Spec: `docs/superpowers/specs/2026-08-12-measure-app-design.md` (authoritative).
Orchestration: Fable coordinates; Sonnet agents execute. Agents do NOT commit or run dev servers; the coordinator commits per phase and verifies in the browser.

## Phase 1 — Scaffold + core (1 agent, blocking)
- Next.js App Router + TypeScript + Tailwind in repo root, static-exportable, PWA (manifest + service worker with update detection).
- `lib/types.ts` — Project/Floor/Unit/Window per spec data model.
- `lib/fractions.ts` — integer-sixteenths math: parse, format ("74 7/8"), round-down-to-eighth, decimal conversion. Unit tests.
- `lib/tags.ts` — tag auto-numbering incl. retro-numbering. Unit tests.
- `lib/db.ts` — Dexie (IndexedDB) stores mirroring the data model + outbox table; CRUD helpers that stamp updated_at and enqueue outbox entries.
- Vitest wired up; `npm run build` and `npm test` green.

## Phase 2 — parallel agents (strict file boundaries)
- **Agent A (exporter):** `lib/export/` only. exceljs workbook per spec mapping; Instructions sheet embedded as constant; golden-file test: build workbook from `fixtures/level4-input.json`, compare every cell value against `fixtures/level4-golden.json` (extracted from the delivered xlsx). Tests in `lib/export/*.test.ts`.
- **Agent B (UI):** `app/` + `components/` only. Dashboard, new-job wizard, floor view, window entry (keypad, ⅛/¹⁄₁₆ switch, chips, checkboxes), against `lib/db.ts`. Mobile-first, big touch targets, dark-mode aware.
- **Agent C (sync):** `lib/sync/` + `supabase/` only. `supabase/migrations/001_init.sql` (tables + RLS for two allowlisted emails), outbox drain with backoff, pull-since-last-sync, `SyncStatus` state hook. Wire-ready but inert without env vars.

## Phase 3 — integration (coordinator)
- Run build + all tests; connect UI ↔ sync status; browser verification (preview, screenshots, airplane-mode simulation via devtools offline).
- Commit; then with Mitch: create Supabase project, set env, deploy to Vercel via CLI, add Mike's email.

## Deferred to launch conversation
Supabase project creation (billing confirm), Vercel project link, Mike's email.
