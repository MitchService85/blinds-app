"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  deleteInvoice,
  getCompany,
  getInvoice,
  getProject,
  listAllInvoices,
  saveInvoice,
} from "@/lib/db";
import { formatCents, parseDollarsToCents } from "@/lib/pricing";
import {
  formatInvoiceDate,
  isEditable,
  issuerFromCompany,
  makeLineItem,
  recalcLine,
  totalsFor,
} from "@/lib/invoice/draft";
import { deliverFile } from "@/lib/export/deliver";
import { triggerSyncIfAvailable } from "@/components/trigger-sync";
import type { Company, InvoiceLineItem, InvoiceRecord, InvoiceStatus, Project } from "@/lib/types";

const STATUS_STYLE: Record<InvoiceStatus, string> = {
  draft: "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300",
  sent: "bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-200",
  paid: "bg-emerald-100 text-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-200",
};

/**
 * One invoice: editable while it is a draft, a frozen record once it is sent
 * (see docs/superpowers/specs/2026-09-02-invoicing-design.md).
 *
 * Every edit writes through immediately and is NOT read back into state — the
 * same rule the project and company screens follow, because awaiting the write
 * per keystroke makes the caret lag and iOS autocorrect lose the word.
 */
export default function InvoicePage() {
  const { projectId, invoiceId } = useParams<{ projectId: string; invoiceId: string }>();
  const router = useRouter();
  const [invoice, setInvoice] = useState<InvoiceRecord | null>(null);
  // The editor autosaves per keystroke, so every save has to start from the
  // newest row, not from whatever React last rendered or the DB last held.
  const latest = useRef<InvoiceRecord | null>(null);
  const [project, setProject] = useState<Project | null>(null);
  const [company, setCompany] = useState<Company | null>(null);
  const [otherNumbers, setOtherNumbers] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [sharing, setSharing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [inv, proj, comp, all] = await Promise.all([
        getInvoice(invoiceId),
        getProject(projectId),
        getCompany(),
        listAllInvoices(),
      ]);
      if (cancelled) return;
      setProject(proj ?? null);
      setCompany(comp ?? null);
      // Same tenant only: a sandbox invoice must not read as a clash with a
      // real one, and the two never appear on the same screen anyway.
      setOtherNumbers(
        all
          .filter(
            (i) =>
              i.id !== invoiceId &&
              (!inv?.company_id || !i.company_id || i.company_id === inv.company_id)
          )
          .map((i) => i.number)
      );

      // A draft re-snapshots the issuer, so correcting the company address
      // repairs everything unsent and leaves sent invoices exactly as they
      // went out.
      let current = inv ?? null;
      if (current && current.status === "draft" && comp) {
        const fresh = issuerFromCompany(comp);
        if (JSON.stringify(fresh) !== JSON.stringify(current.issuer)) {
          current = { ...current, issuer: fresh };
          void saveInvoice(current);
        }
      }
      latest.current = current;
      setInvoice(current);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [invoiceId, projectId]);

  const patch = useCallback((next: Partial<InvoiceRecord>) => {
    const current = latest.current;
    if (!current) return;
    const merged = { ...current, ...next };
    latest.current = merged;
    setInvoice(merged);
    void saveInvoice(merged);
  }, []);

  /** Lines and totals move together — a stored total that disagrees with the
   * lines above it is the one thing an invoice can never do. */
  const patchLines = useCallback(
    (lines: InvoiceLineItem[]) => {
      const current = latest.current;
      if (!current) return;
      patch({ lines, ...totalsFor(lines, current.hst_rate) });
    },
    [patch]
  );

  async function handleShare() {
    if (!invoice || sharing) return;
    setSharing(true);
    try {
      const mod = await import("@/lib/invoice/render");
      const blob = mod.invoicePdfBlob({
        invoice,
        projectName: project?.name ?? "",
        projectAddress: project?.address ?? "",
        accentColor: company?.accent_color ?? "",
      });
      await deliverFile(blob, mod.suggestedInvoiceFilename(invoice));
    } finally {
      setSharing(false);
    }
  }

  function setStatus(status: InvoiceStatus) {
    const now = new Date().toISOString();
    const sentAt = latest.current?.sent_at ?? now;
    if (status === "sent") patch({ status, sent_at: sentAt, paid_at: null });
    else if (status === "paid") patch({ status, sent_at: sentAt, paid_at: now });
    else patch({ status, paid_at: null });
    triggerSyncIfAvailable();
  }

  async function handleDelete() {
    if (!confirm("Delete this draft invoice?")) return;
    await deleteInvoice(invoiceId);
    router.replace(`/project/${projectId}`);
  }

  if (loading) return <main className="p-4 text-sm text-neutral-500">Loading…</main>;
  if (!invoice) {
    return (
      <main className="flex flex-col gap-3 p-4">
        <Link href={`/project/${projectId}`} className="text-sm text-blue-600">
          ← Back
        </Link>
        <p className="text-sm text-neutral-500">That invoice is no longer here.</p>
      </main>
    );
  }

  const editable = isEditable(invoice);
  const duplicate = otherNumbers.some(
    (n) => n.trim().toLowerCase() === invoice.number.trim().toLowerCase() && n.trim() !== ""
  );
  const missingHst = !invoice.issuer.hst_number.trim();

  return (
    <main className="flex flex-1 flex-col gap-5 p-4 pb-28">
      <header className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => router.push(`/project/${projectId}`)}
          className="min-h-11 min-w-11 shrink-0 text-xl"
        >
          ←
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-semibold break-words">{invoice.number || "Invoice"}</h1>
          <div className="text-sm text-neutral-500">
            {formatInvoiceDate(invoice.issue_date)} · {formatCents(invoice.total_cents)}
          </div>
        </div>
        <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_STYLE[invoice.status]}`}>
          {invoice.status}
        </span>
      </header>

      {duplicate && (
        <Banner tone="amber">
          Another invoice already uses the number {invoice.number}. Change one of them before
          sending — a bookkeeper will reject a repeat.
        </Banner>
      )}
      {missingHst && (
        <Banner tone="amber">
          No HST/GST number on this invoice. Add it in{" "}
          <Link href="/company" className="underline">
            company settings
          </Link>{" "}
          — without it the customer can&apos;t claim the tax back.
        </Banner>
      )}
      {!editable && (
        <Banner tone="neutral">
          This invoice is {invoice.status} and locked. Reopen it below if it genuinely needs a
          correction.
        </Banner>
      )}

      <section className="flex flex-col gap-3">
        <Field label="Invoice number" value={invoice.number} editable={editable} onChange={(v) => patch({ number: v })} />
        <div className="flex gap-3">
          <Field
            label="Date"
            type="date"
            value={invoice.issue_date}
            editable={editable}
            onChange={(v) => patch({ issue_date: v })}
          />
          <Field
            label="Due"
            type="date"
            value={invoice.due_date}
            editable={editable}
            onChange={(v) => patch({ due_date: v })}
          />
        </div>
        <div className="flex gap-3">
          <Field label="Terms" value={invoice.terms} editable={editable} onChange={(v) => patch({ terms: v })} />
          <Field
            label="Their PO / order #"
            value={invoice.po_number}
            editable={editable}
            onChange={(v) => patch({ po_number: v })}
          />
        </div>
        <Field
          label="Bill to"
          rows={3}
          value={invoice.bill_to}
          editable={editable}
          onChange={(v) => patch({ bill_to: v })}
        />
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-neutral-500">Lines</h2>
        <div className="flex flex-col gap-2">
          {invoice.lines.map((line) => (
            <LineRow
              key={line.id}
              line={line}
              editable={editable}
              onChange={(next) =>
                patchLines(invoice.lines.map((l) => (l.id === next.id ? next : l)))
              }
              onRemove={() => patchLines(invoice.lines.filter((l) => l.id !== line.id))}
            />
          ))}
          {invoice.lines.length === 0 && (
            <div className="text-sm text-neutral-500">No lines yet.</div>
          )}
        </div>
        {editable && (
          <button
            type="button"
            onClick={() => patchLines([...invoice.lines, makeLineItem("", null, null, 0)])}
            className="mt-2 min-h-11 w-full rounded-lg bg-neutral-100 text-sm font-medium dark:bg-neutral-800"
          >
            + Add line
          </button>
        )}
      </section>

      <section className="rounded-xl border border-neutral-200 p-4 dark:border-neutral-800">
        <dl className="flex flex-col gap-1 text-sm">
          <div className="flex items-baseline justify-between">
            <dt className="text-neutral-600 dark:text-neutral-300">Subtotal</dt>
            <dd className="tabular-nums">{formatCents(invoice.subtotal_cents)}</dd>
          </div>
          <div className="flex items-baseline justify-between">
            <dt className="text-neutral-600 dark:text-neutral-300">
              HST {Math.round(invoice.hst_rate * 1000) / 10}%
            </dt>
            <dd className="tabular-nums">{formatCents(invoice.hst_cents)}</dd>
          </div>
          <div className="mt-1 flex items-baseline justify-between border-t border-neutral-200 pt-1 text-base font-semibold dark:border-neutral-800">
            <dt>Total due</dt>
            <dd className="tabular-nums">{formatCents(invoice.total_cents)}</dd>
          </div>
        </dl>
      </section>

      <section className="flex flex-col gap-3">
        <Field
          label="Notes on the invoice"
          rows={2}
          value={invoice.note}
          editable={editable}
          onChange={(v) => patch({ note: v })}
        />
        <Field
          label="How to pay"
          rows={3}
          value={invoice.payment_instructions}
          editable={editable}
          onChange={(v) => patch({ payment_instructions: v })}
        />
      </section>

      <section className="flex flex-col gap-2">
        <button
          type="button"
          onClick={() => void handleShare()}
          disabled={sharing}
          className="min-h-12 w-full rounded-lg bg-blue-600 text-sm font-semibold text-white disabled:opacity-60"
        >
          {sharing ? "Preparing…" : "Share PDF"}
        </button>

        {invoice.status === "draft" && (
          <button
            type="button"
            onClick={() => setStatus("sent")}
            className="min-h-11 w-full rounded-lg bg-neutral-800 text-sm font-medium text-white dark:bg-neutral-100 dark:text-neutral-900"
          >
            Mark sent
          </button>
        )}
        {invoice.status === "sent" && (
          <>
            <button
              type="button"
              onClick={() => setStatus("paid")}
              className="min-h-11 w-full rounded-lg bg-emerald-600 text-sm font-semibold text-white"
            >
              Mark paid
            </button>
            <button
              type="button"
              onClick={() => setStatus("draft")}
              className="min-h-11 w-full rounded-lg bg-neutral-100 text-sm font-medium dark:bg-neutral-800"
            >
              Reopen as draft
            </button>
          </>
        )}
        {invoice.status === "paid" && (
          <div className="text-center text-xs text-neutral-500">
            Paid {invoice.paid_at ? new Date(invoice.paid_at).toLocaleDateString() : ""}
          </div>
        )}
        {editable && (
          <button
            type="button"
            onClick={() => void handleDelete()}
            className="min-h-11 w-full rounded-lg bg-red-50 text-sm font-medium text-red-700 dark:bg-red-950 dark:text-red-300"
          >
            Delete draft
          </button>
        )}
      </section>
    </main>
  );
}

function Banner({ tone, children }: { tone: "amber" | "neutral"; children: React.ReactNode }) {
  const style =
    tone === "amber"
      ? "bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200"
      : "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300";
  return <div className={`rounded-lg px-3 py-2 text-xs ${style}`}>{children}</div>;
}

function Field({
  label,
  value,
  onChange,
  editable,
  rows,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  editable: boolean;
  rows?: number;
  type?: string;
}) {
  const base =
    "w-full rounded-lg border border-neutral-300 px-3 text-sm dark:border-neutral-700 dark:bg-neutral-900 disabled:opacity-100 disabled:text-neutral-500";
  return (
    <label className="block min-w-0 flex-1">
      <span className="mb-1 block text-sm text-neutral-500">{label}</span>
      {rows ? (
        <textarea
          value={value}
          rows={rows}
          disabled={!editable}
          onChange={(e) => onChange(e.target.value)}
          className={`${base} py-2`}
        />
      ) : (
        <input
          type={type}
          value={value}
          disabled={!editable}
          onChange={(e) => onChange(e.target.value)}
          className={`${base} min-h-11`}
        />
      )}
    </label>
  );
}

/**
 * One editable line. The amount follows qty x rate whenever both are present
 * and is typed directly otherwise, which is what makes a lump sum ("Contract")
 * and a metered line ("Install labor, 96 x $40") the same row type.
 */
function LineRow({
  line,
  editable,
  onChange,
  onRemove,
}: {
  line: InvoiceLineItem;
  editable: boolean;
  onChange: (next: InvoiceLineItem) => void;
  onRemove: () => void;
}) {
  const metered = line.qty !== null && line.unit_cents !== null;
  const cell =
    "min-h-11 w-full rounded-lg border border-neutral-300 px-2 text-sm tabular-nums dark:border-neutral-700 dark:bg-neutral-900 disabled:opacity-100 disabled:text-neutral-500";

  return (
    <div className="rounded-lg border border-neutral-200 p-2 dark:border-neutral-800">
      <div className="flex items-center gap-2">
        <input
          value={line.label}
          disabled={!editable}
          placeholder="Description"
          onChange={(e) => onChange({ ...line, label: e.target.value })}
          className="min-h-11 min-w-0 flex-1 rounded-lg border border-neutral-300 px-2 text-sm dark:border-neutral-700 dark:bg-neutral-900 disabled:opacity-100"
        />
        {editable && (
          <button
            type="button"
            onClick={onRemove}
            aria-label="Remove line"
            className="min-h-11 min-w-11 shrink-0 text-lg text-neutral-400"
          >
            ×
          </button>
        )}
      </div>
      <div className="mt-2 grid grid-cols-3 gap-2">
        <NumberCell
          label="Qty"
          value={line.qty === null ? "" : String(line.qty)}
          disabled={!editable}
          className={cell}
          onChange={(v) => {
            const qty = v.trim() === "" ? null : Number(v);
            onChange(recalcLine({ ...line, qty: Number.isFinite(qty as number) ? qty : null }));
          }}
        />
        <NumberCell
          label="Rate"
          value={line.unit_cents === null ? "" : (line.unit_cents / 100).toFixed(2)}
          disabled={!editable}
          className={cell}
          onChange={(v) => onChange(recalcLine({ ...line, unit_cents: parseDollarsToCents(v) }))}
        />
        <NumberCell
          label="Amount"
          value={(line.amount_cents / 100).toFixed(2)}
          disabled={!editable || metered}
          className={cell}
          onChange={(v) => onChange({ ...line, amount_cents: parseDollarsToCents(v) ?? 0 })}
        />
      </div>
    </div>
  );
}

function NumberCell({
  label,
  value,
  onChange,
  disabled,
  className,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  disabled: boolean;
  className: string;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs text-neutral-400">{label}</span>
      <input
        value={value}
        inputMode="decimal"
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className={className}
      />
    </label>
  );
}
