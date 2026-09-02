-- Invoicing (see docs/superpowers/specs/2026-09-02-invoicing-design.md).
-- Additive only: a new tenant table plus one jsonb column on companies.
-- Applied to project ucvvxgussmnyuaexaaxj.

-- Billing identity — legal name, address, HST registration number, payment
-- terms and instructions. One jsonb column rather than eight text ones, the
-- same shape of call as projects.pricing.
alter table companies add column if not exists billing jsonb;

create table if not exists invoices (
  id uuid primary key default gen_random_uuid(),
  updated_at timestamptz not null default now(),
  deleted boolean not null default false,
  company_id uuid not null references companies (id) on delete cascade,
  project_id uuid not null references projects (id) on delete cascade,

  number text not null default '',
  -- Calendar dates as "YYYY-MM-DD" TEXT, not date/timestamptz. They are the
  -- day the invoice was issued in Toronto and must not shift when read from
  -- another zone; keeping them text also means a malformed or empty value is
  -- a visible bad string rather than a rejected insert, and a rejected insert
  -- on a local-first client wedges that table's outbox forever.
  issue_date text not null default '',
  due_date text not null default '',
  status text not null default 'draft',
  sent_at timestamptz,
  paid_at timestamptz,

  bill_to text not null default '',
  po_number text not null default '',
  terms text not null default '',

  -- Frozen at issue: the line items, the tax rate that applied, the totals,
  -- and who was billing. Nothing here is ever recomputed on read — that is
  -- the whole difference between an invoice and the Money card.
  lines jsonb not null default '[]'::jsonb,
  hst_rate numeric not null default 0.13,
  subtotal_cents bigint not null default 0,
  hst_cents bigint not null default 0,
  total_cents bigint not null default 0,
  note text not null default '',
  payment_instructions text not null default '',
  issuer jsonb not null default '{}'::jsonb,

  constraint invoices_status_known check (status in ('draft', 'sent', 'paid'))
);

create index if not exists invoices_sync_idx on invoices (company_id, updated_at, id);
create index if not exists invoices_project_idx on invoices (project_id, issue_date);

alter table invoices enable row level security;

-- Same tenant policy shape as every other table in 001.
create policy invoices_tenant on invoices
  for all to authenticated
  using (company_id = current_company_id())
  with check (company_id = current_company_id());

grant select, insert, update, delete on invoices to authenticated;
