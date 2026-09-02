"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  getCompany,
  inviteMember,
  listMembers,
  removeMember,
  setMemberRole,
  updateCompany,
} from "@/lib/db";
import { compressImage } from "@/lib/photos";
import { triggerSyncIfAvailable } from "@/components/trigger-sync";
import { emptyBilling } from "@/lib/invoice/draft";
import type { Company, CompanyBilling, Membership } from "@/lib/types";

/**
 * Company settings and the team roster.
 *
 * Branding here is stored for quoting to print later — a quote goes out under
 * the company's name, not the app's. Everything writes through lib/db.ts, so
 * edits are durable offline and sync like any other row; the server rejects
 * anything a non-admin tries, so this screen hides admin controls for
 * members rather than pretending they will work.
 */
export default function CompanyPage() {
  const [company, setCompany] = useState<Company | null>(null);
  // Billing is one jsonb value, so each edit rewrites the whole record. This
  // ref is what it merges into: reading React state instead would let two
  // edits landing in the same render both start from the pre-edit billing,
  // and the second would quietly revert the first.
  const latestBilling = useRef<CompanyBilling | null>(null);
  const [members, setMembers] = useState<Membership[]>([]);
  const [loading, setLoading] = useState(true);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);

  const refresh = useCallback(async () => {
    const [c, m] = await Promise.all([getCompany(), listMembers()]);
    setCompany(c ?? null);
    setMembers(m);
    setLoading(false);
  }, []);

  useEffect(() => {
    // Load in an async callback rather than the effect body: setting state
    // synchronously inside an effect cascades renders (the same rule the
    // export-history hook follows).
    let cancelled = false;
    void (async () => {
      const [c, m] = await Promise.all([getCompany(), listMembers()]);
      if (cancelled) return;
      latestBilling.current = c?.billing ?? null;
      setCompany(c ?? null);
      setMembers(m);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * Patch a branding field. State updates synchronously and the write follows:
   * awaiting the DB round-trip per keystroke made the caret lag and iOS
   * autocorrect lose the word it was fixing (field report, 2026-08-27).
   */
  function patch(next: Partial<Company>) {
    setCompany((c) => (c ? { ...c, ...next } : c));
    void updateCompany(next).then(() => {
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 1200);
      triggerSyncIfAvailable();
    });
  }

  /** Patch one billing field. Billing is a single jsonb value, so a partial
   * edit has to be merged against the whole record, never written alone. */
  function patchBilling(next: Partial<CompanyBilling>) {
    const billing = { ...(latestBilling.current ?? emptyBilling()), ...next };
    latestBilling.current = billing;
    setCompany((c) => (c ? { ...c, billing } : c));
    void updateCompany({ billing }).then(() => {
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 1200);
      triggerSyncIfAvailable();
    });
  }

  async function handleLogo(file: File) {
    // Same compression as unit photos: inline data URL, no blob storage to
    // fail in a dead zone.
    patch({ logo: await compressImage(file) });
  }

  async function handleInvite() {
    const email = inviteEmail.trim().toLowerCase();
    setInviteError(null);
    if (!email || !email.includes("@")) {
      setInviteError("Enter an email address.");
      return;
    }
    if (members.some((m) => m.email === email)) {
      setInviteError("That address is already on the team.");
      return;
    }
    await inviteMember(email);
    setInviteEmail("");
    await refresh();
    triggerSyncIfAvailable();
  }

  if (loading) {
    return <main className="p-4 text-sm text-neutral-500">Loading…</main>;
  }

  if (!company) {
    return (
      <main className="flex flex-col gap-3 p-4">
        <Link href="/" className="text-sm text-blue-600">
          ← Back
        </Link>
        <p className="text-sm text-neutral-500">
          No company on this device yet. Sign in to sync and it will appear here.
        </p>
      </main>
    );
  }

  return (
    <main className="flex flex-1 flex-col gap-5 p-4 pb-24">
      <header className="safe-sticky-top sticky z-20 -mx-4 flex items-center gap-3 bg-white/95 px-4 pb-3 backdrop-blur dark:bg-neutral-950/95">
        <Link href="/" className="min-h-11 min-w-11 shrink-0 text-xl leading-[2.75rem]">
          ←
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-semibold break-words">{company.name || "Your company"}</h1>
          <div className="text-sm text-neutral-500">Company settings</div>
        </div>
        {savedFlash && (
          <span className="shrink-0 text-xs text-emerald-600 dark:text-emerald-400">✓ saved</span>
        )}
      </header>

      <section className="flex flex-col gap-3">
        <div>
          <label className="mb-1 block text-sm text-neutral-500" htmlFor="company-name">
            Company name
          </label>
          <input
            id="company-name"
            type="text"
            value={company.name}
            onChange={(e) => patch({ name: e.target.value })}
            className="min-h-11 w-full rounded-lg border border-neutral-300 px-3 text-sm dark:border-neutral-700 dark:bg-neutral-900"
          />
        </div>

        <div>
          <div className="mb-1 text-sm text-neutral-500">
            Logo <span className="text-neutral-400">(printed on quotes)</span>
          </div>
          <div className="flex items-center gap-3">
            {company.logo ? (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={company.logo}
                  alt="Company logo"
                  className="h-16 w-16 rounded-lg border border-neutral-300 object-contain dark:border-neutral-700"
                />
                <button
                  type="button"
                  onClick={() => patch({ logo: "" })}
                  className="min-h-9 rounded-lg bg-neutral-100 px-3 text-xs font-medium dark:bg-neutral-800"
                >
                  Remove
                </button>
              </>
            ) : (
              <label className="flex h-16 w-16 cursor-pointer items-center justify-center rounded-lg border border-dashed border-neutral-300 text-2xl text-neutral-500 dark:border-neutral-700">
                +
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void handleLogo(f);
                  }}
                />
              </label>
            )}
          </div>
        </div>

        <div>
          <label className="mb-1 block text-sm text-neutral-500" htmlFor="quote-footer">
            Quote footer <span className="text-neutral-400">(optional)</span>
          </label>
          <textarea
            id="quote-footer"
            value={company.quote_footer}
            onChange={(e) => patch({ quote_footer: e.target.value })}
            placeholder="e.g. Prices valid 30 days. HST extra."
            rows={2}
            className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900"
          />
        </div>
      </section>

      <BillingSection billing={company.billing ?? emptyBilling()} onChange={patchBilling} />

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold text-neutral-500">Team</h2>

        {members.map((m) => (
          <div
            key={m.id}
            className="flex items-center gap-2 rounded-lg border border-neutral-200 p-3 dark:border-neutral-800"
          >
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">{m.email}</div>
              <div className="text-xs text-neutral-500">
                {m.role === "admin" ? "Admin" : "Member"}
                {m.status === "invited" && " · invited, not signed in yet"}
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                void setMemberRole(m.id, m.role === "admin" ? "member" : "admin").then(refresh);
              }}
              className="min-h-9 shrink-0 rounded-lg bg-neutral-100 px-2.5 text-xs font-medium dark:bg-neutral-800"
            >
              {m.role === "admin" ? "Make member" : "Make admin"}
            </button>
            <button
              type="button"
              onClick={() => {
                if (
                  window.confirm(
                    `Remove ${m.email}? They lose access immediately, and their measurements stay with the company.`
                  )
                ) {
                  void removeMember(m.id).then(refresh);
                }
              }}
              className="min-h-9 shrink-0 rounded-lg bg-red-50 px-2.5 text-xs font-medium text-red-700 dark:bg-red-950 dark:text-red-300"
            >
              Remove
            </button>
          </div>
        ))}

        <div className="mt-1 flex flex-col gap-2 rounded-lg border border-dashed border-neutral-300 p-3 dark:border-neutral-700">
          <label className="text-xs text-neutral-500" htmlFor="invite-email">
            Invite someone by email. They join when they first sign in.
          </label>
          <div className="flex gap-2">
            <input
              id="invite-email"
              type="email"
              inputMode="email"
              autoCapitalize="none"
              autoCorrect="off"
              value={inviteEmail}
              onChange={(e) => {
                setInviteEmail(e.target.value);
                setInviteError(null);
              }}
              placeholder="name@company.com"
              className="min-h-11 flex-1 rounded-lg border border-neutral-300 px-3 text-sm dark:border-neutral-700 dark:bg-neutral-900"
            />
            <button
              type="button"
              onClick={() => void handleInvite()}
              className="min-h-11 shrink-0 rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white"
            >
              Invite
            </button>
          </div>
          {inviteError && <div className="text-xs text-red-600">{inviteError}</div>}
        </div>
      </section>
    </main>
  );
}

/**
 * Billing identity — what gets printed on an invoice and copied onto it at
 * issue time. The HST number carries a warning because a Canadian invoice
 * over $30 without one cannot be claimed as an input tax credit, which is how
 * an invoice comes back from accounts payable instead of getting paid.
 */
function BillingSection({
  billing,
  onChange,
}: {
  billing: CompanyBilling;
  onChange: (next: Partial<CompanyBilling>) => void;
}) {
  const [open, setOpen] = useState(false);
  const filled = Boolean(billing.hst_number.trim() && billing.address.trim());

  return (
    <section className="flex flex-col gap-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex min-h-11 items-center justify-between text-left"
      >
        <span className="text-sm font-semibold text-neutral-500">Invoicing details</span>
        <span className="flex items-center gap-2 text-xs text-neutral-400">
          {!filled && (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 font-medium text-amber-900 dark:bg-amber-950/50 dark:text-amber-200">
              incomplete
            </span>
          )}
          {open ? "Hide" : "Edit"}
        </span>
      </button>

      {open && (
        <div className="flex flex-col gap-3 rounded-xl border border-neutral-200 p-4 dark:border-neutral-800">
          <BillingField
            label="Legal name"
            hint="Only if it differs from the company name above."
            value={billing.legal_name}
            onChange={(v) => onChange({ legal_name: v })}
          />
          <BillingField
            label="Address"
            value={billing.address}
            rows={3}
            onChange={(v) => onChange({ address: v })}
          />
          <BillingField
            label="Email"
            value={billing.email}
            type="email"
            onChange={(v) => onChange({ email: v })}
          />
          <BillingField
            label="Phone"
            value={billing.phone}
            type="tel"
            onChange={(v) => onChange({ phone: v })}
          />
          <BillingField
            label="HST / GST number"
            hint="Required on any invoice over $30 for the customer to claim the tax back."
            placeholder="12345 6789 RT0001"
            value={billing.hst_number}
            onChange={(v) => onChange({ hst_number: v })}
          />
          <BillingField
            label="Invoice prefix"
            hint={`Numbers run ${billing.invoice_prefix.trim() ? `${billing.invoice_prefix.trim()}-0001` : "0001"}, 0002, …`}
            placeholder="KIS"
            value={billing.invoice_prefix}
            onChange={(v) => onChange({ invoice_prefix: v })}
          />
          <BillingField
            label="Payment terms"
            hint="Sets the due date on a new invoice. “Net 30” means 30 days out."
            placeholder="Net 30"
            value={billing.payment_terms}
            onChange={(v) => onChange({ payment_terms: v })}
          />
          <BillingField
            label="How to pay"
            rows={3}
            placeholder="e-transfer to ap@example.com, or cheque payable to …"
            value={billing.payment_instructions}
            onChange={(v) => onChange({ payment_instructions: v })}
          />
          <BillingField
            label="Default bill to"
            hint="Prefilled on every new invoice — usually the office you send them all to."
            rows={3}
            value={billing.default_bill_to}
            onChange={(v) => onChange({ default_bill_to: v })}
          />
        </div>
      )}
    </section>
  );
}

function BillingField({
  label,
  hint,
  value,
  onChange,
  rows,
  placeholder,
  type = "text",
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (v: string) => void;
  rows?: number;
  placeholder?: string;
  type?: string;
}) {
  const className =
    "w-full rounded-lg border border-neutral-300 px-3 text-sm dark:border-neutral-700 dark:bg-neutral-900";
  return (
    <label className="block">
      <span className="mb-1 block text-sm text-neutral-500">{label}</span>
      {rows ? (
        <textarea
          value={value}
          rows={rows}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          className={`${className} py-2`}
        />
      ) : (
        <input
          type={type}
          value={value}
          placeholder={placeholder}
          autoCapitalize={type === "email" ? "none" : undefined}
          autoCorrect={type === "email" ? "off" : undefined}
          onChange={(e) => onChange(e.target.value)}
          className={`${className} min-h-11`}
        />
      )}
      {hint && <span className="mt-1 block text-xs text-neutral-400">{hint}</span>}
    </label>
  );
}
