# Multi-Tenant Companies & Team Logins — Design

Date: 2026-08-30
Status: Approved by Mitch (brainstorm 2026-08-30)
Depends on: everything through commit 312299a. Precedes: quoting mode (branded quotes need a company to carry the branding).

## Purpose

Measure stops being a two-person allowlist and becomes a product other blind-install
companies can use. Each company is an isolated workspace — its own jobs, users and
branding — with Mitch's crew as the first tenant. Branding stored here is what
quoting mode will later print on quotes.

Decisions made in the brainstorm:

- **Tenants are other installer companies** (a real product), not just a bigger crew
  and not an Elite-specific umbrella.
- **Sales-led onboarding**: a company exists only when Mitch creates it and invites
  its first admin. No public signup, no billing plumbing in v1.
- **Roles: admin + member.** Admins invite/remove people and edit company settings
  and branding; members do everything else (measure, install, export, issues).
- **Infra: a NEW free-tier Supabase project in a new org** (the current org is at its
  2-project cap and shares a database with HyperFocus), plus **Resend free tier** for
  sign-in emails (the built-in sender's ~2/hour cap is unusable for teams). Upgrade
  to Pro the day a customer pays.

## Architecture: one schema, company_id everywhere, DB-enforced isolation

Chosen over schema-per-tenant (migrations × N companies, per-schema PostgREST
exposure, onboarding = a deploy) and over JWT-claim tenancy (stale claims keep a
removed installer inside until token expiry — the exact failure that must not
happen).

- Every tenant-owned table carries `company_id uuid not null references companies`.
- RLS policies change from `is_allowed_user()` to
  `company_id = current_company_id()` where `current_company_id()` is a
  security-definer lookup of the caller's **active** membership. Removal locks a
  user out on their next request, not their next login.
- The sync engine is unchanged in shape: pull is filtered by RLS (a phone cannot
  receive another company's rows), push stamps `company_id` client-side on create;
  the server double-checks via `with check`.

## Data model (new project, consolidated migration 001)

- **companies**: id, updated_at, deleted, name, plus branding consumed later by
  quoting: `logo` (compressed JPEG/PNG data URL ≤~250KB, same inline pattern as
  unit photos), `accent_color` (hex, optional), `quote_footer` (text, optional).
- **memberships**: id, updated_at, deleted, company_id, user_id (auth.users),
  email (lowercase), role `admin|member`, status `invited|active`. Unique on
  (company_id, email), and **v1 additionally enforces one company per email**
  (unique on email overall): `current_company_id()` is singular and sign-in
  needs no company picker. `blinds.allowed_users` is retired.
  See "Known limitation: one company per person" below — this is a deferred
  decision, not an assumption that the case does not exist.
- **platform_admins**: user_id list (Mitch). Grants exactly two abilities: create a
  company, create/revoke its invites. **A platform admin cannot read tenant data**
  — support access can be added later, with consent; the sales pitch includes
  "your measurements aren't visible even to us."
- Existing tables (projects, floors, units, windows, photos, exports) all gain
  `company_id`. All current data is stamped with the crew's company during
  migration.
- The consolidated migration folds in everything 001+002 learned (issue_* columns,
  panel_controls, checks_ack, chain_length, motorized_override, tight_override,
  exports table) so the new project starts clean at 001.

## Auth and invites

- Sign-in is unchanged for users: email + 8-digit code, no passwords, no links.
  Codes are delivered via **Resend SMTP** configured on the new project.
- Invite flow: an admin types an email → pending membership row. First code
  sign-in by that email activates the membership. Uninviting deletes the pending
  row; removing an active member soft-deletes it (locked out on next request).
- Sign-in with no membership anywhere → friendly "ask your company admin to
  invite you" screen; nothing is created.
- Company creation (platform admin only): name + first admin email, via a small
  `/platform` page visible only to platform admins.

## Client changes

- Dexie gains `companies` + `memberships` stores; every row creation stamps the
  session's `company_id` (cached after sign-in; cleared on sign-out).
- New **Company screen** (admins): name, logo, accent colour, quote footer,
  member list with invite/remove. Members see it read-only minus invites.
- **No seed data for new companies.** Today's seed projects are Arbour, 44
  Charles and Cleveland — real client measurements that must never appear in
  another installer's workspace. New companies start empty; the help page
  carries onboarding. The crew's company keeps its existing (formerly seeded,
  since adopted) projects as ordinary data. `lib/seed.ts` is retired from the
  first-run path.
- Sign-out control moves next to sync status (multi-user devices need it).

## Migration and cutover

1. Create the new Supabase project (new org), apply consolidated migration,
   configure Resend SMTP + 8-digit OTP, allow prod redirect origins.
2. Server-side copy: old `blinds` schema → new project, stamping the crew's
   company_id. Verified by row counts per table + spot checksums.
3. **Cutover sequence (the risk is unpushed phone edits):** both phones sync
   clean on the old backend → deploy the build pointing at the new project →
   each phone signs in again (new auth domain) and does a fresh first pull.
   Local Dexie is versioned up with a one-time reset-and-repull guarded on the
   backend URL change.
4. The old `blinds` schema in the HyperFocus project stays untouched as a
   fallback until Mitch is satisfied, then is dropped in a later cleanup.

## Testing

- Pure: membership resolution, invite state machine, company stamping in
  buildExportInput/sync normalizers (extend existing suites).
- RLS: SQL tests via MCP on the new project — user A cannot select/insert/update
  B's rows across every table; platform admin can create companies but cannot
  select tenant rows; removed member loses access mid-session.
- Golden-file export test unchanged (company_id never reaches the workbook).
- Manual: two-account walkthrough (Mitch + a test account in a second company).

## Known limitation: one company per person (deferred 2026-08-30)

**This case is already real, not hypothetical.** Mike works Keep It Shady jobs
sourced through Elite *and* Le Decor jobs through Danny. Under v1's unique-email
rule he can hold only one workspace, so his likely workaround is a second email
address — which fragments his identity and is worse than designing for it.

The schema already permits it: `memberships` is a join table and a second row
per user is natural. What v1 omits is the *active company* concept it would
need — a header switcher (hidden for the single-company majority), the choice
remembered per device, `current_company_id()` reading that choice instead of
assuming a sole membership, and switching triggering a local reset-and-repull
so a phone never holds two tenants' rows at once (the same mechanism the
cutover already requires).

Deliberately deferred so v1 ships; **revisit before onboarding any company
whose crew is shared with another company on the platform**, which includes
Le Decor if Danny ever becomes a tenant. Lifting it means dropping one unique
constraint and adding the switcher; no data migration.

## Accepting an invite (revised 2026-09-02)

The original flow had the signing-in person flip their own membership from
`invited` to `active`. They cannot, and both halves of the deadlock are
deliberate:

- `memberships_write` is admin-only, so a plain member's `UPDATE` is refused.
- `current_company_id()` counts only an **active** membership, so before
  activation the invitee resolves to no company — which means
  `memberships_read` shows them nothing, and they cannot even *see* the invite
  addressed to them.

Activation therefore happens in `accept_invite()` (migration 003), a
security-definer function that is the one place neither policy applies. It
will only ever touch a row whose email equals the address on the caller's own
token, which GoTrue set from the inbox the code was mailed to — proving you
can read that inbox is exactly what accepting an invite means, so the match
*is* the authorisation. It never creates a membership (a company still exists
only when Mitch sets one up), never touches `role`, and treats a soft-deleted
row as the removal it is.

Where someone already belongs to a team, that team wins over a later invite
from a second company: switching underfoot would be the worst possible way to
meet the limitation below.

A second defect went with it. The client had been reading the roster with an
unfiltered `limit(1)` — `memberships_read` returns the whole team — and then
stamping *that arbitrary row* with the signing-in user's id and marking it
accepted, so an invite could be consumed by someone it was never sent to. It
had already happened once in production. Sign-in is now a single
`accept_invite()` call and reads no roster at all.

## Out of scope (v1)

Self-serve signup, billing/subscriptions, viewer role, per-tenant export
formats (multi-format thread), Elite umbrella views, transferring projects
between companies, support/impersonation access.
