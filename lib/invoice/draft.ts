// Turning job money into an issuable document (see
// docs/superpowers/specs/2026-09-02-invoicing-design.md).
//
// Pure functions over plain shapes, like lib/pricing.ts and lib/export/shared.ts:
// nothing here touches Dexie, so the editor can recompute a total on every
// keystroke and the tests can run the whole lifecycle without a database.
import { HST_RATE, type Invoice } from "../pricing";
import type {
  Company,
  CompanyBilling,
  InvoiceIssuer,
  InvoiceLineItem,
  InvoiceRecord,
} from "../types";

/** An all-blank billing record, for a company that has never invoiced. */
export function emptyBilling(): CompanyBilling {
  return {
    legal_name: "",
    address: "",
    email: "",
    phone: "",
    hst_number: "",
    invoice_prefix: "",
    payment_terms: "Net 30",
    payment_instructions: "",
    default_bill_to: "",
  };
}

/**
 * The next number in the company's own series.
 *
 * Matches only numbers whose non-digit head is this company's prefix, so
 * switching "KIS" to "SHADY" starts a new run rather than inheriting the old
 * one, and a hand-typed one-off ("CREDIT-2") never bumps the counter.
 */
export function nextInvoiceNumber(prefix: string, existing: string[]): string {
  const head = prefix.trim() ? `${prefix.trim()}-` : "";
  let max = 0;
  for (const raw of existing) {
    const m = /^(.*?)(\d+)$/.exec(raw.trim());
    if (!m) continue;
    if (m[1].toLowerCase() !== head.toLowerCase()) continue;
    max = Math.max(max, parseInt(m[2], 10));
  }
  return `${head}${String(max + 1).padStart(4, "0")}`;
}

/** Today as a local "YYYY-MM-DD". Built from local parts on purpose: an
 * invoice dated by UTC is dated tomorrow for most of a Toronto evening. */
export function todayISODate(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** Add days to a "YYYY-MM-DD", staying in UTC so no DST boundary shifts it. */
export function addDays(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  if (!y || !m || !d) return isoDate;
  const t = Date.UTC(y, m - 1, d) + days * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

/** "Net 30" -> issue date + 30 days. Anything we can't read leaves it blank,
 * which prints no due date at all rather than a wrong one. */
export function dueDateFrom(issueDate: string, terms: string): string {
  const m = /net\s*(\d+)/i.exec(terms);
  return m ? addDays(issueDate, parseInt(m[1], 10)) : "";
}

/** The issuer block as it stands right now. Snapshotted onto each invoice. */
export function issuerFromCompany(
  company: Pick<Company, "name" | "logo" | "billing">
): InvoiceIssuer {
  const b = company.billing ?? emptyBilling();
  return {
    name: b.legal_name.trim() || company.name,
    address: b.address,
    email: b.email,
    phone: b.phone,
    hst_number: b.hst_number,
    logo: company.logo,
  };
}

/** One editable row. Amount follows qty x rate unless the row is a lump sum. */
export function makeLineItem(
  label: string,
  qty: number | null,
  unitCents: number | null,
  amountCents: number
): InvoiceLineItem {
  return { id: crypto.randomUUID(), label, qty, unit_cents: unitCents, amount_cents: amountCents };
}

/**
 * Recompute a row's amount after an edit. A row with both a quantity and a
 * rate is arithmetic; a row with either missing is a lump sum whose amount
 * the user types directly, so it is left alone.
 */
export function recalcLine(line: InvoiceLineItem): InvoiceLineItem {
  if (line.qty === null || line.unit_cents === null) return line;
  return { ...line, amount_cents: Math.round(line.qty * line.unit_cents) };
}

export interface InvoiceTotals {
  subtotal_cents: number;
  hst_cents: number;
  total_cents: number;
}

/** Cents stay integers everywhere except this one rounding, at the tax line —
 * the same rule the Money card follows. */
export function totalsFor(lines: InvoiceLineItem[], hstRate: number): InvoiceTotals {
  const subtotal = lines.reduce((sum, l) => sum + l.amount_cents, 0);
  const hst = Math.round(subtotal * hstRate);
  return { subtotal_cents: subtotal, hst_cents: hst, total_cents: subtotal + hst };
}

/** The computed job lines, handed over as ordinary editable rows. */
export function linesFromComputed(invoice: Invoice): InvoiceLineItem[] {
  return invoice.lines.map((l) =>
    makeLineItem(l.label, l.qty, l.unit_cents, l.amount_cents)
  );
}

export interface DraftSeed {
  projectId: string;
  /** Lines to start from — usually linesFromComputed(computeInvoice(...)). */
  lines: InvoiceLineItem[];
  company: Pick<Company, "name" | "logo" | "billing">;
  /** Numbers already used, so the new one continues the series. */
  existingNumbers: string[];
  /** Their PO / work order / factory order number, when we know one. */
  poNumber?: string;
  now?: Date;
}

/** Everything a new draft needs, ready to hand to createInvoice. */
export function buildDraft(seed: DraftSeed): Omit<InvoiceRecord, "id" | "updated_at" | "deleted"> {
  const billing = seed.company.billing ?? emptyBilling();
  const issueDate = todayISODate(seed.now ?? new Date());
  const terms = billing.payment_terms;
  const totals = totalsFor(seed.lines, HST_RATE);
  return {
    project_id: seed.projectId,
    number: nextInvoiceNumber(billing.invoice_prefix, seed.existingNumbers),
    issue_date: issueDate,
    due_date: dueDateFrom(issueDate, terms),
    status: "draft",
    sent_at: null,
    paid_at: null,
    bill_to: billing.default_bill_to,
    po_number: seed.poNumber ?? "",
    terms,
    lines: seed.lines,
    hst_rate: HST_RATE,
    ...totals,
    note: "",
    payment_instructions: billing.payment_instructions,
    issuer: issuerFromCompany(seed.company),
  };
}

/** Only a draft may be edited or deleted; sent and paid are the record. */
export function isEditable(invoice: Pick<InvoiceRecord, "status">): boolean {
  return invoice.status === "draft";
}

/** Numbers used more than once across the company's invoices. */
export function duplicateNumbers(invoices: Pick<InvoiceRecord, "number">[]): Set<string> {
  const seen = new Set<string>();
  const dupes = new Set<string>();
  for (const { number } of invoices) {
    const key = number.trim().toLowerCase();
    if (!key) continue;
    if (seen.has(key)) dupes.add(key);
    seen.add(key);
  }
  return dupes;
}

/** "Sep 2, 2026" from a "YYYY-MM-DD", read as a calendar date, not a moment. */
export function formatInvoiceDate(isoDate: string): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  if (!y || !m || !d) return isoDate;
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-CA", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}
