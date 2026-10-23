"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  addFixItems,
  createInvoice,
  deleteFixBatch,
  getCompany,
  getFixBatch,
  getProject,
  listAllInvoices,
  listFixItems,
  listFloors,
  listInvoices,
  listProjectFixItems,
  loadFixGather,
  saveFixItem,
  setFixStatus,
  setIssueFixNote,
  updateFixBatch,
} from "@/lib/db";
import {
  QUICK_NOTES,
  fixCounts,
  fixInvoiceLines,
  gatherFixItems,
  inBatchIds,
  hasQuickNote,
  isInvoiced,
  readyToBill,
  suggestedFixNote,
  toggleQuickNote,
  type FixItemSeed,
} from "@/lib/fixes";
import { buildDraft } from "@/lib/invoice/draft";
import { formatCents, parseDollarsToCents } from "@/lib/pricing";
import { triggerSyncIfAvailable } from "@/components/trigger-sync";
import { BackButton } from "@/components/back-button";
import { BottomBar } from "@/components/bottom-bar";
import { useRemoteVersion } from "@/lib/sync-events";
import type { Company, FixBatch, FixItem, InvoiceRecord, Project } from "@/lib/types";

type Filter = "todo" | "done" | "all";

const FAULT_LABEL = { factory: "Factory error", measure: "Our measure error" } as const;

/** "Oct 16" — when a fix was ticked off. */
function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-CA", { month: "short", day: "numeric" });
}

/**
 * One deficiency fix batch: every flagged blind gathered from its floors,
 * worked down on site one tap at a time, then billed.
 *
 * Notes autosave per keystroke and are not read back into state — the same
 * rule as the invoice and project screens, because reading a write back a
 * keystroke late reverts the input mid-word.
 */
const REMOTE_TABLES_FIXES = ["fix_batches", "fix_items", "invoices", "units", "windows"] as const;

export default function FixBatchPage() {
  const { projectId, batchId } = useParams<{ projectId: string; batchId: string }>();
  const router = useRouter();
  const [batch, setBatch] = useState<FixBatch | null>(null);
  const [items, setItems] = useState<FixItem[]>([]);
  const latest = useRef<Map<string, FixItem>>(new Map());
  const firstLoad = useRef(true);
  const [project, setProject] = useState<Project | null>(null);
  const [company, setCompany] = useState<Company | null>(null);
  const [invoices, setInvoices] = useState<InvoiceRecord[]>([]);
  const [floorLabels, setFloorLabels] = useState<Map<string, string>>(new Map());
  const [newSeeds, setNewSeeds] = useState<FixItemSeed[]>([]);
  const [filter, setFilter] = useState<Filter>("todo");
  const [rateText, setRateText] = useState("");
  const [loading, setLoading] = useState(true);
  const [billing, setBilling] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  // Ticked off on this visit: kept on the To do list until the page is left,
  // so a note can still be added (or the tap undone) right where it was.
  const [justDone, setJustDone] = useState<Set<string>>(new Set());
  // The other phone's ticks and notes arrive here without reopening.
  const remote = useRemoteVersion(REMOTE_TABLES_FIXES);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const b = await getFixBatch(batchId);
      if (!b) {
        if (!cancelled) setLoading(false);
        return;
      }
      const [its, proj, comp, invs, floors, projectItems] = await Promise.all([
        listFixItems(batchId),
        getProject(projectId),
        getCompany(),
        listInvoices(projectId),
        listFloors(projectId),
        listProjectFixItems(projectId),
      ]);
      // Blinds flagged on the batch's floors since it was made, so a flag
      // added mid-run can join without starting a new batch.
      const gather = (await loadFixGather(projectId, b.floor_ids)).map((f) => f.gather);
      const fresh = gatherFixItems(gather, inBatchIds(projectItems), its.length);
      if (cancelled) return;
      latest.current = new Map(its.map((i) => [i.id, i]));
      setBatch(b);
      setItems(its);
      setProject(proj ?? null);
      setCompany(comp ?? null);
      setInvoices(invs);
      setFloorLabels(new Map(floors.map((f) => [f.id, f.label])));
      setNewSeeds(fresh);
      setRateText(b.rate_cents === null ? "" : (b.rate_cents / 100).toFixed(2));
      // Open on what is left to do, or on the whole list once nothing is —
      // on first load only, not every time the other phone's work arrives.
      if (firstLoad.current && its.every((i) => i.status !== "open")) setFilter("all");
      firstLoad.current = false;
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [batchId, projectId, remote]);

  if (loading) return <main className="p-4 text-sm text-neutral-500">Loading…</main>;
  if (!batch) {
    return (
      <main className="flex flex-col gap-4 p-4">
        <BackButton href={`/project/${projectId}`} label="Back to job" />
        <p className="text-sm text-neutral-500">This fix batch was deleted.</p>
      </main>
    );
  }

  const liveInvoiceIds = new Set(invoices.map((i) => i.id));
  const invoiceNumber = new Map(invoices.map((i) => [i.id, i.number]));
  const counts = fixCounts(items);
  const toBill = readyToBill(items, liveInvoiceIds);
  const fixesToBill = toBill.reduce((n, i) => n + i.qty, 0);
  const rate = batch.rate_cents;
  const multiFloor = batch.floor_ids.length > 1;

  const shown = items.filter((i) =>
    filter === "all" ? true : filter === "todo" ? i.status === "open" || justDone.has(i.id) : i.status !== "open"
  );

  // Group by unit, keeping gathered order.
  const groups: Array<{ key: string; title: string; items: FixItem[] }> = [];
  for (const item of shown) {
    const last = groups[groups.length - 1];
    if (last && last.key === item.unit_id) last.items.push(item);
    else {
      const floor = multiFloor ? `${floorLabels.get(item.floor_id) ?? ""} · ` : "";
      groups.push({ key: item.unit_id, title: `${floor}Unit ${item.unit_number}`, items: [item] });
    }
  }

  function replace(next: FixItem) {
    latest.current.set(next.id, next);
    setItems((prev) => prev.map((i) => (i.id === next.id ? next : i)));
  }

  function edit(id: string, patch: Partial<FixItem>) {
    const current = latest.current.get(id);
    if (!current) return;
    const next = { ...current, ...patch };
    replace(next);
    void saveFixItem(next).then(() => triggerSyncIfAvailable());
    // A fixed blind carries what was done on its own ⚠ record too.
    if (patch.fix_note !== undefined && next.status === "fixed" && next.deficiency_id) {
      void setIssueFixNote(next.deficiency_id, next.fix_note);
    }
  }

  async function changeStatus(id: string, status: FixItem["status"]) {
    const current = latest.current.get(id);
    if (!current) return;
    // Fixed with nothing written: fill in the likely note so the record says
    // what was done without any typing. It stays editable.
    const note =
      status === "fixed" && !current.fix_note.trim() ? suggestedFixNote(current.problem) : current.fix_note;
    const saved = await setFixStatus({ ...current, fix_note: note }, status);
    replace(saved);
    if (status !== "open") setJustDone((prev) => new Set(prev).add(id));
    triggerSyncIfAvailable();
  }

  async function handleRate(text: string) {
    if (!batch) return;
    setRateText(text);
    const cents = text.trim() === "" ? null : parseDollarsToCents(text);
    if (text.trim() !== "" && cents === null) return;
    setBatch({ ...batch, rate_cents: cents });
    await updateFixBatch(batch.id, { rate_cents: cents });
    triggerSyncIfAvailable();
  }

  async function handleAddNew() {
    if (!batch || newSeeds.length === 0) return;
    await addFixItems(batch, newSeeds);
    const its = await listFixItems(batch.id);
    latest.current = new Map(its.map((i) => [i.id, i]));
    setItems(its);
    setNewSeeds([]);
    setFilter("todo");
    triggerSyncIfAvailable();
  }

  function pickFilter(next: Filter) {
    setFilter(next);
    setJustDone(new Set());
  }

  async function handleInvoice() {
    if (!batch || !project || rate === null || toBill.length === 0 || billing) return;
    setBilling(true);
    try {
      const all = await listAllInvoices();
      const sameCompany = all.filter(
        (r) => !project.company_id || !r.company_id || r.company_id === project.company_id
      );
      const draft = buildDraft({
        projectId: project.id,
        lines: fixInvoiceLines(toBill, rate),
        company: company ?? { name: "", logo: "", billing: null },
        existingNumbers: sameCompany.map((i) => i.number),
      });
      const created = await createInvoice({ ...draft, note: `Deficiency fixes — ${batch.name}` });
      for (const item of toBill) {
        const current = latest.current.get(item.id) ?? item;
        await saveFixItem({ ...current, invoice_id: created.id });
      }
      triggerSyncIfAvailable();
      router.push(`/project/${project.id}/invoice/${created.id}`);
    } finally {
      setBilling(false);
    }
  }

  async function handleDelete() {
    if (!batch) return;
    await deleteFixBatch(batch.id);
    triggerSyncIfAvailable();
    router.push(`/project/${projectId}`);
  }

  return (
    <main className="flex flex-1 flex-col gap-4 p-4">
      <header className="flex items-center gap-3">
        <BackButton href={`/project/${projectId}`} label="Back to job" />
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-semibold break-words">{batch.name}</h1>
          <div className="text-sm text-neutral-500">{project?.name}</div>
        </div>
      </header>

      <section aria-label="Progress" className="flex flex-col gap-2">
        <div className="h-2 overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800">
          <div
            className="h-full bg-emerald-500 transition-[width]"
            style={{ width: `${counts.total ? ((counts.fixed + counts.cant) / counts.total) * 100 : 0}%` }}
          />
        </div>
        <div className="text-sm text-neutral-600 dark:text-neutral-300">
          <span className="font-semibold">{counts.fixed}</span> of {counts.total} fixed
          {counts.cant > 0 && <> · {counts.cant} couldn&apos;t fix</>}
          {counts.open > 0 && <> · {counts.open} to do</>}
        </div>
      </section>

      {newSeeds.length > 0 && (
        <button
          type="button"
          onClick={() => void handleAddNew()}
          className="min-h-12 rounded-xl border border-amber-300 bg-amber-50 px-4 text-left text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200"
        >
          {newSeeds.length} more {newSeeds.length === 1 ? "blind was" : "blinds were"} flagged on these floors
          since this batch started. <span className="font-semibold underline">Add to batch</span>
        </button>
      )}

      <div role="tablist" className="flex overflow-hidden rounded-lg border border-neutral-300 dark:border-neutral-700">
        {(
          [
            ["todo", `To do (${counts.open})`],
            ["done", `Done (${counts.fixed + counts.cant})`],
            ["all", `All (${counts.total})`],
          ] as Array<[Filter, string]>
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={filter === key}
            onClick={() => pickFilter(key)}
            className={`min-h-11 flex-1 text-sm font-medium ${
              filter === key ? "bg-neutral-800 text-white dark:bg-neutral-100 dark:text-neutral-900" : ""
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {shown.length === 0 && (
        <p className="py-6 text-center text-sm text-neutral-500">
          {filter === "todo" ? "Nothing left to fix. Bill it below." : "Nothing here yet."}
        </p>
      )}

      {groups.map((g) => (
        <section key={g.key} className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold text-neutral-500">{g.title}</h2>
          {g.items.map((item) => {
            const billed = isInvoiced(item, liveInvoiceIds);
            const locked = billed;
            return (
              <article
                key={item.id}
                className={`flex flex-col gap-3 rounded-xl border p-3 ${
                  item.status === "fixed"
                    ? "border-emerald-300 bg-emerald-50/60 dark:border-emerald-800 dark:bg-emerald-950/30"
                    : item.status === "cant"
                      ? "border-neutral-300 bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-900"
                      : "border-amber-300 dark:border-amber-800"
                }`}
              >
                <div>
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <span className="text-lg font-semibold">{item.blind_label || "Blind"}</span>
                    {item.panels > 1 && <span className="text-xs text-neutral-500">{item.panels} panels</span>}
                    {item.fault && (
                      <span className="rounded bg-neutral-200 px-1.5 text-[11px] font-medium dark:bg-neutral-700">
                        {FAULT_LABEL[item.fault]}
                      </span>
                    )}
                    {item.recut && (
                      <span className="rounded bg-neutral-200 px-1.5 text-[11px] font-medium dark:bg-neutral-700">
                        Recut
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 text-sm">{item.problem || "Flagged, no note"}</div>
                </div>

                {item.status === "open" ? (
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => void changeStatus(item.id, "fixed")}
                      className="min-h-12 flex-1 rounded-lg bg-emerald-600 text-base font-semibold text-white active:bg-emerald-700"
                    >
                      ✓ Fixed
                    </button>
                    <button
                      type="button"
                      onClick={() => void changeStatus(item.id, "cant")}
                      className="min-h-12 rounded-lg bg-neutral-100 px-4 text-sm font-medium dark:bg-neutral-800"
                    >
                      Can&apos;t fix
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center justify-between gap-2 text-sm">
                    <span className={item.status === "fixed" ? "font-semibold text-emerald-700 dark:text-emerald-400" : "font-semibold"}>
                      {item.status === "fixed"
                        ? `✓ Fixed${item.fixed_at ? ` ${shortDate(item.fixed_at)}` : ""}`
                        : "Couldn't fix here"}
                      {billed && (
                        <span className="ml-2 font-normal text-neutral-500">
                          · billed on {invoiceNumber.get(item.invoice_id ?? "") || "invoice"}
                        </span>
                      )}
                    </span>
                    {!locked && (
                      <button
                        type="button"
                        onClick={() => void changeStatus(item.id, "open")}
                        className="min-h-10 rounded-lg px-3 text-sm text-blue-600"
                      >
                        Undo
                      </button>
                    )}
                  </div>
                )}

                <div className="flex flex-wrap gap-1.5">
                  {QUICK_NOTES.map((chip) => {
                    const on = hasQuickNote(item.fix_note, chip);
                    return (
                      <button
                        key={chip}
                        type="button"
                        disabled={locked}
                        aria-pressed={on}
                        onClick={() => edit(item.id, { fix_note: toggleQuickNote(item.fix_note, chip) })}
                        className={`min-h-9 rounded-full border px-3 text-xs font-medium disabled:opacity-60 ${
                          on
                            ? "border-blue-600 bg-blue-600 text-white"
                            : "border-neutral-300 bg-white dark:border-neutral-700 dark:bg-neutral-900"
                        }`}
                      >
                        {chip}
                      </button>
                    );
                  })}
                </div>
                <input
                  type="text"
                  value={item.fix_note}
                  disabled={locked}
                  onChange={(e) => edit(item.id, { fix_note: e.target.value })}
                  placeholder={item.status === "cant" ? "Why not? e.g. needs remake" : "What was done"}
                  aria-label={`What was done on ${item.unit_number} ${item.blind_label}`}
                  className="min-h-11 w-full rounded-lg border border-neutral-300 bg-white px-3 text-sm disabled:opacity-60 dark:border-neutral-700 dark:bg-neutral-900"
                />

                <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                  <div className="flex items-center gap-2">
                    <span className="text-neutral-500">Bills as</span>
                    <button
                      type="button"
                      disabled={locked || item.qty <= 1}
                      onClick={() => edit(item.id, { qty: item.qty - 1 })}
                      aria-label="One fewer fix"
                      className="h-9 w-9 rounded-lg bg-neutral-100 text-lg disabled:opacity-40 dark:bg-neutral-800"
                    >
                      −
                    </button>
                    <span className="min-w-14 text-center font-medium">
                      {item.qty} {item.qty === 1 ? "fix" : "fixes"}
                    </span>
                    <button
                      type="button"
                      disabled={locked}
                      onClick={() => edit(item.id, { qty: item.qty + 1 })}
                      aria-label="One more fix"
                      className="h-9 w-9 rounded-lg bg-neutral-100 text-lg disabled:opacity-40 dark:bg-neutral-800"
                    >
                      +
                    </button>
                  </div>
                  <label className="flex min-h-9 items-center gap-2">
                    <input
                      type="checkbox"
                      className="h-5 w-5"
                      disabled={locked}
                      checked={item.billable}
                      onChange={(e) => edit(item.id, { billable: e.target.checked })}
                    />
                    <span>Charge for it</span>
                  </label>
                </div>
              </article>
            );
          })}
        </section>
      ))}

      <section className="mt-2 flex flex-col gap-3 rounded-xl border border-neutral-200 p-4 dark:border-neutral-800">
        <h2 className="font-semibold">Billing</h2>
        <label className="flex items-center justify-between gap-3">
          <span className="text-sm">
            Charge per fix
            <span className="block text-xs text-neutral-500">One fix = one panel worked on</span>
          </span>
          <span className="flex items-center gap-1">
            <span className="text-neutral-500">$</span>
            <input
              inputMode="decimal"
              value={rateText}
              onChange={(e) => void handleRate(e.target.value)}
              placeholder="0.00"
              aria-label="Charge per fix in dollars"
              className="min-h-11 w-28 rounded-lg border border-neutral-300 px-3 text-right dark:border-neutral-700 dark:bg-neutral-900"
            />
          </span>
        </label>
        <div className="text-sm text-neutral-600 dark:text-neutral-300">
          {toBill.length === 0
            ? counts.fixed > 0
              ? "Every fixed blind is already billed or set not to charge."
              : "Tick blinds off as you fix them; they bill from here."
            : `${toBill.length} ${toBill.length === 1 ? "blind" : "blinds"} fixed and not billed yet · ${fixesToBill} ${
                fixesToBill === 1 ? "fix" : "fixes"
              }${rate !== null ? ` · ${formatCents(fixesToBill * rate)} before HST` : ""}`}
        </div>
        {confirmDelete ? (
          <div className="flex items-center justify-between gap-2 text-sm">
            <span>Delete this batch? Blinds keep their flags; invoices stay.</span>
            <span className="flex shrink-0 gap-2">
              <button type="button" onClick={() => void handleDelete()} className="min-h-10 rounded-lg bg-rose-600 px-3 font-semibold text-white">
                Delete
              </button>
              <button type="button" onClick={() => setConfirmDelete(false)} className="min-h-10 rounded-lg bg-neutral-100 px-3 dark:bg-neutral-800">
                Keep
              </button>
            </span>
          </div>
        ) : (
          <button type="button" onClick={() => setConfirmDelete(true)} className="min-h-10 self-start text-sm text-rose-600">
            Delete batch
          </button>
        )}
      </section>

      <BottomBar>
        <button
          type="button"
          onClick={() => void handleInvoice()}
          disabled={toBill.length === 0 || rate === null || billing}
          className="min-h-14 flex-1 rounded-xl bg-blue-600 text-base font-semibold text-white active:bg-blue-700 disabled:bg-neutral-300 disabled:text-neutral-600 dark:disabled:bg-neutral-800 dark:disabled:text-neutral-400"
        >
          {billing
            ? "Making invoice…"
            : toBill.length === 0
              ? "Nothing to bill yet"
              : rate === null
                ? "Set a charge per fix to bill"
                : `Make invoice — ${fixesToBill} ${fixesToBill === 1 ? "fix" : "fixes"}`}
        </button>
      </BottomBar>
    </main>
  );
}
