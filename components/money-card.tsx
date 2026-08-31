"use client";

import { useEffect, useState } from "react";
import { db, listFloors, updateProject } from "@/lib/db";
import {
  computeInvoice,
  countActualBlinds,
  countRemoved,
  emptyPricing,
  formatCents,
  parseDollarsToCents,
  type Invoice,
  type MoneyFloor,
} from "@/lib/pricing";
import type { Project, ProjectPricing } from "@/lib/types";
import { deliverFile } from "@/lib/export/deliver";

/** A floor's money slice plus what the invoice workbook's appendix needs. */
interface FloorMoney {
  label: string;
  order_number: string;
  money: MoneyFloor;
}

interface MoneyCardProps {
  project: Project;
  /** Parent's copy of the project must follow a pricing save. */
  onProjectChange: (project: Project) => void;
}

/**
 * The project screen's Money card (see
 * docs/superpowers/plans/2026-08-21-job-money-plan.md): Danny's locked
 * contract, the crew's billable extras computed from live counts, HST, and
 * the actual-vs-quoted variance badge. Invisible until pricing is set up —
 * a project with no money recorded shows only the "Set up pricing" affordance.
 */
/** Pure data load (no state writes) — same split as the project page's
 * loadProjectData, and bulk reads like the dashboard: three queries total,
 * however many floors and units the project has. */
async function loadFloorMoney(projectId: string): Promise<FloorMoney[]> {
  const floorRows = await listFloors(projectId);
  const units = await db.units
    .where("floor_id")
    .anyOf(floorRows.map((f) => f.id))
    .filter((u) => !u.deleted)
    .toArray();
  const windows = await db.windows
    .where("unit_id")
    .anyOf(units.map((u) => u.id))
    .filter((w) => !w.deleted)
    .toArray();

  const windowsByUnit = new Map<string, typeof windows>();
  for (const w of windows) {
    const list = windowsByUnit.get(w.unit_id) ?? [];
    list.push(w);
    windowsByUnit.set(w.unit_id, list);
  }
  return floorRows.map((f) => ({
    label: f.label,
    order_number: f.order_number ?? "",
    money: {
      defaults: f.defaults,
      trips: f.trips,
      units: units
        .filter((u) => u.floor_id === f.id)
        .map((u) => ({
          status: u.status,
          removed: u.removed ?? 0,
          windows: (windowsByUnit.get(u.id) ?? []).map((w) => ({
            widths: w.widths,
            quantity: w.quantity,
            motorized_override: w.motorized_override,
          })),
        })),
    },
  }));
}

export function MoneyCard({ project, onProjectChange }: MoneyCardProps) {
  const [floors, setFloors] = useState<FloorMoney[] | null>(null);
  const [editing, setEditing] = useState(false);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    (async () => {
      setFloors(await loadFloorMoney(project.id));
    })();
  }, [project.id]);

  async function handleSave(pricing: ProjectPricing) {
    const updated = await updateProject(project.id, { pricing });
    onProjectChange(updated);
    setEditing(false);
  }

  const pricing = project.pricing ?? null;
  const invoice =
    pricing && floors ? computeInvoice(pricing, floors.map((f) => f.money)) : null;

  async function handleInvoiceExport() {
    if (!pricing || !floors || !invoice || exporting) return;
    setExporting(true);
    try {
      const mod = await import("@/lib/export/invoice").catch(() => null);
      if (!mod) return;
      const input = {
        project_name: project.name,
        address: project.address,
        export_date: new Date().toISOString().slice(0, 10),
        order_numbers: floors.map((f) => f.order_number).filter(Boolean),
        invoice,
        note: pricing.note,
        floors: floors.map((f) => ({
          label: f.label,
          blinds: countActualBlinds([f.money]),
          removed: countRemoved([f.money]),
          trips: f.money.trips,
        })),
      };
      const blob = await mod.exportInvoiceToBlob(input);
      await deliverFile(blob, mod.suggestedInvoiceFilename(input));
    } finally {
      setExporting(false);
    }
  }

  return (
    <section>
      <div className="mb-2 flex items-baseline justify-between">
        <h2 className="text-sm font-semibold text-neutral-500">Money</h2>
        {pricing && (
          <button type="button" onClick={() => setEditing(true)} className="text-sm text-blue-600">
            Edit
          </button>
        )}
      </div>

      {!pricing ? (
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="min-h-11 w-full rounded-lg bg-neutral-100 text-sm font-medium dark:bg-neutral-800"
        >
          + Set up pricing
        </button>
      ) : (
        invoice && (
          <div className="rounded-xl border border-neutral-200 p-4 dark:border-neutral-800">
            <InvoiceLines invoice={invoice} />
            <VarianceBadge invoice={invoice} />
            {pricing.note && (
              <div className="mt-2 text-xs text-neutral-500">{pricing.note}</div>
            )}
            {invoice.lines.length > 0 && (
              <button
                type="button"
                onClick={() => void handleInvoiceExport()}
                disabled={exporting}
                className="mt-3 min-h-11 w-full rounded-lg bg-neutral-800 text-sm font-medium text-white active:bg-neutral-700 disabled:opacity-60 dark:bg-neutral-100 dark:text-neutral-900"
              >
                {exporting ? "Exporting…" : "Invoice summary (.xlsx)"}
              </button>
            )}
          </div>
        )
      )}

      {editing && (
        <PricingSheet
          initial={pricing ?? emptyPricing()}
          onSave={handleSave}
          onClose={() => setEditing(false)}
        />
      )}
    </section>
  );
}

function InvoiceLines({ invoice }: { invoice: Invoice }) {
  return (
    <>
      {invoice.lines.length === 0 && (
        <div className="text-sm text-neutral-500">Nothing billable yet.</div>
      )}
      <dl className="flex flex-col gap-1 text-sm">
        {invoice.lines.map((line) => (
          <div key={line.key} className="flex items-baseline justify-between gap-2">
            <dt className="text-neutral-600 dark:text-neutral-300">
              {line.label}
              {line.qty !== null && line.unit_cents !== null && (
                <span className="text-neutral-400">
                  {" "}
                  ({line.qty} × {formatCents(line.unit_cents)})
                </span>
              )}
            </dt>
            <dd className="tabular-nums">{formatCents(line.amount_cents)}</dd>
          </div>
        ))}
        {invoice.lines.length > 0 && (
          <>
            <div className="mt-1 flex items-baseline justify-between border-t border-neutral-200 pt-1 dark:border-neutral-800">
              <dt className="text-neutral-600 dark:text-neutral-300">Subtotal</dt>
              <dd className="tabular-nums">{formatCents(invoice.subtotal_cents)}</dd>
            </div>
            <div className="flex items-baseline justify-between">
              <dt className="text-neutral-600 dark:text-neutral-300">HST 13%</dt>
              <dd className="tabular-nums">{formatCents(invoice.hst_cents)}</dd>
            </div>
            <div className="flex items-baseline justify-between text-base font-semibold">
              <dt>Total</dt>
              <dd className="tabular-nums">{formatCents(invoice.total_cents)}</dd>
            </div>
          </>
        )}
      </dl>
    </>
  );
}

/**
 * Actual blinds vs Danny's plan-takeoff count. Over-quote gets the amber
 * warning treatment (same idea as the measurement checks: flag it before it
 * costs us) — that's the change-order conversation, to be had before install.
 */
function VarianceBadge({ invoice }: { invoice: Invoice }) {
  const base = "mt-3 inline-block rounded-full px-2.5 py-1 text-xs font-medium";
  if (invoice.variance === null) {
    return (
      <div className={`${base} bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300`}>
        {invoice.actual_blinds} blind{invoice.actual_blinds === 1 ? "" : "s"} measured
      </div>
    );
  }
  if (invoice.variance > 0) {
    return (
      <div className={`${base} bg-amber-100 text-amber-900 dark:bg-amber-950/50 dark:text-amber-200`}>
        ⚠ {invoice.actual_blinds} measured — {invoice.variance} over quote
      </div>
    );
  }
  if (invoice.variance < 0) {
    return (
      <div className={`${base} bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300`}>
        {invoice.actual_blinds} measured — {-invoice.variance} under quote
      </div>
    );
  }
  return (
    <div className={`${base} bg-emerald-100 text-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-200`}>
      ✓ {invoice.actual_blinds} measured — matches quote
    </div>
  );
}

// ---------------------------------------------------------------------------
// Editor sheet
// ---------------------------------------------------------------------------

const centsToInput = (cents: number | null): string =>
  cents === null ? "" : (cents / 100).toFixed(2).replace(/\.00$/, "");

interface PricingSheetProps {
  initial: ProjectPricing;
  onSave: (pricing: ProjectPricing) => Promise<void>;
  onClose: () => void;
}

function PricingSheet({ initial, onSave, onClose }: PricingSheetProps) {
  // Dollar fields live as strings while editing; blank = not billed.
  const [contract, setContract] = useState(centsToInput(initial.contract_cents));
  const [quoted, setQuoted] = useState(
    initial.quoted_blind_count === null ? "" : String(initial.quoted_blind_count)
  );
  const [removal, setRemoval] = useState(centsToInput(initial.removal_per_blind_cents));
  const [install, setInstall] = useState(centsToInput(initial.install_per_blind_cents));
  const [motorized, setMotorized] = useState(centsToInput(initial.motorized_premium_cents));
  const [trip, setTrip] = useState(centsToInput(initial.trip_charge_cents));
  const [note, setNote] = useState(initial.note);
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    if (saving) return;
    setSaving(true);
    try {
      const quotedCount = /^\d+$/.test(quoted.trim()) ? parseInt(quoted.trim(), 10) : null;
      await onSave({
        contract_cents: parseDollarsToCents(contract),
        quoted_blind_count: quotedCount,
        removal_per_blind_cents: parseDollarsToCents(removal),
        install_per_blind_cents: parseDollarsToCents(install),
        motorized_premium_cents: parseDollarsToCents(motorized),
        trip_charge_cents: parseDollarsToCents(trip),
        note,
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center"
      onClick={onClose}
    >
      <div
        className="flex max-h-[85vh] w-full max-w-sm flex-col overflow-y-auto rounded-xl bg-white p-4 dark:bg-neutral-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 text-sm font-semibold">Job pricing</div>
        <div className="flex flex-col gap-3">
          <DollarField
            label="Contract (Danny's locked price)"
            value={contract}
            onChange={setContract}
          />
          <label>
            <span className="mb-1 block text-sm text-neutral-500">
              Quoted blind count (from the plan takeoff)
            </span>
            <input
              value={quoted}
              onChange={(e) => setQuoted(e.target.value)}
              inputMode="numeric"
              placeholder="e.g. 96"
              className="min-h-11 w-full rounded-lg border border-neutral-300 px-3 text-sm dark:border-neutral-700 dark:bg-neutral-900"
            />
          </label>
          <DollarField label="Removal, per old blind" value={removal} onChange={setRemoval} />
          <DollarField label="Install labor, per blind" value={install} onChange={setInstall} />
          <DollarField
            label="Motorized premium, per blind"
            value={motorized}
            onChange={setMotorized}
          />
          <DollarField label="Trip charge, per trip" value={trip} onChange={setTrip} />
          <label>
            <span className="mb-1 block text-sm text-neutral-500">Note</span>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. install billed to Elite net 30"
              rows={2}
              className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900"
            />
          </label>
          <div className="text-xs text-neutral-400">
            Leave a rate blank when it isn&apos;t billed on this job — e.g. install already
            inside the contract.
          </div>
        </div>
        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={onClose}
            className="min-h-11 flex-1 rounded-lg bg-neutral-100 text-sm font-medium dark:bg-neutral-800"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={saving}
            className="min-h-11 flex-1 rounded-lg bg-blue-600 text-sm font-semibold text-white disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

function DollarField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const invalid = value.trim() !== "" && parseDollarsToCents(value) === null;
  return (
    <label>
      <span className="mb-1 block text-sm text-neutral-500">{label}</span>
      <div className="relative">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-neutral-400">
          $
        </span>
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          inputMode="decimal"
          placeholder="not billed"
          className={`min-h-11 w-full rounded-lg border px-3 pl-7 text-sm dark:bg-neutral-900 ${
            invalid
              ? "border-red-400 dark:border-red-600"
              : "border-neutral-300 dark:border-neutral-700"
          }`}
        />
      </div>
    </label>
  );
}
