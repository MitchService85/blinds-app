"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
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
  CANT_REASONS,
  QUICK_NOTES,
  billedInvoiceIds,
  fixCounts,
  fixInvoiceLines,
  fixedUnbilled,
  gatherFixItems,
  inBatchIds,
  hasQuickNote,
  isGuessedNote,
  isInvoiced,
  noteForStatus,
  readyToBill,
  reopenedOnInvoice,
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

const FAULT_LABEL = { factory: "Factory error", measure: "Measure error" } as const;

/** "Oct 16" — when a fix was ticked off. */
function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-CA", { month: "short", day: "numeric" });
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** Fit the box to what is in it, so a long note is never read through a slot. */
function grow(el: HTMLTextAreaElement) {
  el.style.height = "auto";
  el.style.height = `${el.scrollHeight}px`;
}

/**
 * The "what was done" / "why not" box. Tapping into a note that already says
 * something ("Shimmed") is nearly always to add to it, so the cursor goes to
 * the end with ", " ready — on a phone, placing a cursor after a word with a
 * gloved thumb is the slowest thing on this screen. A trailing ", " left
 * unused is taken off again on the way out.
 */
function NoteBox({
  value,
  onChange,
  placeholder,
  label,
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder: string;
  label: string;
}) {
  return (
    <textarea
      ref={(el) => {
        if (el) grow(el);
      }}
      rows={2}
      value={value}
      placeholder={placeholder}
      aria-label={label}
      onChange={(e) => {
        grow(e.currentTarget);
        onChange(e.currentTarget.value);
      }}
      onFocus={(e) => {
        const el = e.currentTarget;
        const v = el.value;
        if (v.trim() && !/,\s*$/.test(v)) onChange(`${v.trimEnd()}, `);
        requestAnimationFrame(() => el.setSelectionRange(el.value.length, el.value.length));
      }}
      onBlur={(e) => {
        const v = e.currentTarget.value;
        const trimmed = v.replace(/[,\s]+$/, "");
        if (trimmed !== v) onChange(trimmed);
      }}
      className="w-full resize-none rounded-lg border border-neutral-300 bg-white px-3 py-2.5 text-base dark:border-neutral-700 dark:bg-neutral-900"
    />
  );
}

function Chips({
  options,
  note,
  onToggle,
}: {
  options: readonly string[];
  note: string;
  onToggle: (chip: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((chip) => {
        const on = hasQuickNote(note, chip);
        return (
          <button
            key={chip}
            type="button"
            aria-pressed={on}
            onClick={() => onToggle(chip)}
            className={`min-h-11 rounded-full border px-3.5 text-sm font-medium ${
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
  );
}

function Badge({ children }: { children: ReactNode }) {
  return (
    <span className="rounded bg-neutral-200 px-1.5 text-[11px] font-medium dark:bg-neutral-700">{children}</span>
  );
}

/**
 * One deficiency batch: every open deficiency on a blind gathered from its
 * floors, worked down on site one tap at a time, then billed.
 *
 * Each card is only as big as what is left to do on it. A 27-deficiency batch
 * used to be thirteen screens of identical cards, each carrying chips, a note
 * box and billing controls whether or not the blind had been touched; now an
 * open one is its two buttons, a ticked one is one line, and the money lives
 * in one panel at the end where it is done once.
 *
 * Notes autosave per keystroke and are not read back into state — the same
 * rule as the invoice and project screens, because reading a write back a
 * keystroke late reverts the input mid-word.
 */
const REMOTE_TABLES_FIXES = ["fix_batches", "fix_items", "invoices", "units", "windows"] as const;

/** Room the pinned bottom bar (88px plus the safe area) takes off the screen, with a little air. */
const BAR_ALLOWANCE = 120;

export default function FixBatchPage() {
  const { projectId, batchId } = useParams<{ projectId: string; batchId: string }>();
  const router = useRouter();
  const [batch, setBatch] = useState<FixBatch | null>(null);
  const [items, setItems] = useState<FixItem[]>([]);
  const latest = useRef<Map<string, FixItem>>(new Map());
  const firstLoad = useRef(true);
  const rateInput = useRef<HTMLInputElement>(null);
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
  // Ticked off on this visit (or tapped open from the Done list): kept on the
  // To do list, open enough to Change or Undo, until the page is left.
  const [justDone, setJustDone] = useState<Set<string>>(new Set());
  // Ticked ones whose chips and note box are showing.
  const [changing, setChanging] = useState<Set<string>>(new Set());
  // Where to bring the screen after a tick: the next blind still to fix.
  const [scrollTarget, setScrollTarget] = useState<{ id: string; at: number } | null>(null);
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
      // Deficiencies raised on the batch's floors since it was made, so one
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

  // After the card that was ticked has shrunk to its one line, bring the next
  // one in "nearest" fashion: not at all if it is already clear of the bottom
  // bar, otherwise just enough. Done by hand because scrollIntoView's
  // "nearest" counts a card hidden behind the pinned bar as on screen (it
  // ignores scroll-margin for an element already in the viewport).
  useEffect(() => {
    if (!scrollTarget) return;
    const el = document.getElementById(scrollTarget.id);
    if (!el) return;
    const r = el.getBoundingClientRect();
    const top = 16;
    const bottom = window.innerHeight - BAR_ALLOWANCE;
    const by = r.top < top ? r.top - top : r.bottom > bottom ? Math.min(r.bottom - bottom, r.top - top) : 0;
    if (by !== 0) window.scrollBy({ top: by, behavior: "smooth" });
  }, [scrollTarget]);

  if (loading) return <main className="p-4 text-sm text-neutral-500">Loading…</main>;
  if (!batch) {
    return (
      <main className="flex flex-col gap-4 p-4">
        <BackButton href={`/project/${projectId}`} label="Back to job" />
        <p className="text-sm text-neutral-500">This deficiency batch was deleted.</p>
      </main>
    );
  }

  const liveInvoiceIds = new Set(invoices.map((i) => i.id));
  const invoiceNumber = (id: string | null) => (id && invoices.find((i) => i.id === id)?.number) || "invoice";
  const counts = fixCounts(items);
  const toBill = readyToBill(items, liveInvoiceIds);
  const billRows = fixedUnbilled(items, liveInvoiceIds);
  const billedOn = billedInvoiceIds(items, liveInvoiceIds);
  const fixesToBill = toBill.reduce((n, i) => n + i.qty, 0);
  const rate = batch.rate_cents;
  const multiFloor = batch.floor_ids.length > 1;
  const fixesLabel = plural(fixesToBill, "fix", "fixes");

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
    // A fixed blind carries what was done on its own deficiency too.
    if (patch.fix_note !== undefined && next.status === "fixed" && next.deficiency_id) {
      void setIssueFixNote(next.deficiency_id, next.fix_note, { fromBatch: true });
    }
  }

  function toggleSet(set: Set<string>, id: string, on: boolean): Set<string> {
    const next = new Set(set);
    if (on) next.add(id);
    else next.delete(id);
    return next;
  }

  /** The next blind still to fix after this one, in walking order. */
  function nextOpenAfter(id: string): string | null {
    const at = items.findIndex((i) => i.id === id);
    const after = [...items.slice(at + 1), ...items.slice(0, Math.max(0, at))];
    return after.find((i) => i.status === "open")?.id ?? null;
  }

  async function changeStatus(id: string, status: FixItem["status"]) {
    const current = latest.current.get(id);
    if (!current) return;
    // ✓ Fixed with nothing written fills in the likely note so the record
    // says what was done without any typing; Undo takes an untouched guess
    // back out (see noteForStatus).
    const note = noteForStatus(current, status);
    const next = status === "open" ? null : nextOpenAfter(id);
    const saved = await setFixStatus({ ...current, fix_note: note }, status);
    replace(saved);
    if (status === "open" && note !== current.fix_note && current.deficiency_id) {
      void setIssueFixNote(current.deficiency_id, note, { fromBatch: true });
    }
    setJustDone((prev) => toggleSet(prev, id, status !== "open"));
    setChanging((prev) => toggleSet(prev, id, false));
    if (status !== "open") {
      const target = next ? `fix-${next}` : "fix-all-done";
      setScrollTarget((prev) => ({ id: target, at: (prev?.at ?? 0) + 1 }));
    }
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
    setChanging(new Set());
  }

  /** The bottom bar's job: take you to the bill, and to the rate if it is still blank. */
  function goToBill() {
    document.getElementById("bill")?.scrollIntoView({ block: "start", behavior: "smooth" });
    if (rate === null) rateInput.current?.focus({ preventScroll: true });
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
      // The invoice's back arrow comes back here, not to the job.
      router.push(`/project/${project.id}/invoice/${created.id}?from=fixes/${batch.id}`);
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

  function header(item: FixItem) {
    const reopened = reopenedOnInvoice(item, liveInvoiceIds);
    return (
      <div>
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span className="text-lg font-semibold">{item.blind_label || "Blind"}</span>
          {/* Only when it is more than the one fix every card is — the full
              charging controls are in the bill panel. */}
          {item.qty > 1 && (
            <Badge>{item.qty <= item.panels ? `${item.qty} of ${item.panels} panels` : `${item.qty} fixes`}</Badge>
          )}
          {item.fault && <Badge>{FAULT_LABEL[item.fault]}</Badge>}
          {item.recut && <Badge>Recut</Badge>}
        </div>
        <div className="mt-0.5 text-sm">{item.problem || "Deficiency (no note)"}</div>
        {reopened && (
          <div className="mt-1 text-sm font-medium text-amber-800 dark:text-amber-300">
            On invoice {invoiceNumber(item.invoice_id)} — reopened
          </div>
        )}
      </div>
    );
  }

  function card(item: FixItem) {
    const billed = isInvoiced(item, liveInvoiceIds);
    const id = `fix-${item.id}`;

    if (item.status === "open") {
      return (
        <article
          key={item.id}
          id={id}
          className={`flex flex-col gap-3 rounded-xl border border-amber-300 p-3 dark:border-amber-800`}
        >
          {header(item)}
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
        </article>
      );
    }

    const fixed = item.status === "fixed";
    const tone = fixed
      ? "border-emerald-300 bg-emerald-50/60 dark:border-emerald-800 dark:bg-emerald-950/30"
      : "border-neutral-300 bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-900";
    const note = item.fix_note.trim();
    const billedText = billed ? ` · billed on ${invoiceNumber(item.invoice_id)}` : "";

    // Done on an earlier visit: one line. Tap it to see it whole.
    if (!justDone.has(item.id)) {
      const status = fixed
        ? `✓ Fixed${item.fixed_at ? ` ${shortDate(item.fixed_at)}` : ""}${note ? ` — ${note}` : ""}${billedText}`
        : `Couldn't fix${note ? ` — ${note}` : ""}`;
      return (
        <article key={item.id} id={id} className={`rounded-xl border ${tone}`}>
          <button
            type="button"
            onClick={() => setJustDone((prev) => toggleSet(prev, item.id, true))}
            aria-label={`${item.blind_label}: ${status}. Show`}
            className="flex min-h-11 w-full items-center gap-2 px-3 py-2 text-left text-sm"
          >
            <span className="shrink-0 font-semibold">{item.blind_label || "Blind"}</span>
            <span
              className={`min-w-0 flex-1 truncate ${fixed ? "text-emerald-800 dark:text-emerald-300" : "text-neutral-600 dark:text-neutral-300"}`}
            >
              {status}
            </span>
          </button>
        </article>
      );
    }

    const editing = changing.has(item.id);
    const guessed = isGuessedNote(item);
    return (
      <article
        key={item.id}
        id={id}
        className={`flex flex-col rounded-xl border ${fixed ? "gap-1 px-3 py-2" : "gap-2 p-3"} ${tone}`}
      >
        {fixed ? (
          // Ticked: the blind and what was wrong on one line — the work is
          // done, the status row below is what is still worth reading.
          <div className="flex min-w-0 items-baseline gap-2">
            <span className="shrink-0 text-lg font-semibold">{item.blind_label || "Blind"}</span>
            <span className="min-w-0 truncate text-sm text-neutral-600 dark:text-neutral-300">
              {item.problem || "Deficiency (no note)"}
            </span>
          </div>
        ) : (
          header(item)
        )}
        <div className="flex min-h-11 items-center gap-1 text-sm">
          <span
            className={`min-w-0 flex-1 font-semibold ${fixed ? "text-emerald-700 dark:text-emerald-400" : ""}`}
          >
            {fixed ? (
              <>
                ✓ Fixed{billed && item.fixed_at ? ` ${shortDate(item.fixed_at)}` : ""}
                {note && <span className="font-normal text-neutral-700 dark:text-neutral-200"> — {note}</span>}
                {guessed && <span className="font-normal text-neutral-500"> (guessed)</span>}
                {billed && <span className="font-normal text-neutral-500">{billedText}</span>}
              </>
            ) : (
              "Couldn't fix"
            )}
          </span>
          {fixed && !billed && (
            <button
              type="button"
              onClick={() => setChanging((prev) => toggleSet(prev, item.id, !editing))}
              aria-expanded={editing}
              className="min-h-11 shrink-0 rounded-lg px-2.5 font-medium text-blue-600"
            >
              {editing ? "Done" : note ? "Change" : "Add note"}
            </button>
          )}
          {!billed && (
            <button
              type="button"
              onClick={() => void changeStatus(item.id, "open")}
              className="-mr-1 min-h-11 shrink-0 rounded-lg px-2.5 font-medium text-blue-600"
            >
              Undo
            </button>
          )}
        </div>
        {fixed && editing && (
          <>
            <Chips
              options={QUICK_NOTES}
              note={item.fix_note}
              onToggle={(chip) => edit(item.id, { fix_note: toggleQuickNote(item.fix_note, chip) })}
            />
            <NoteBox
              value={item.fix_note}
              onChange={(v) => edit(item.id, { fix_note: v })}
              placeholder="What was done"
              label={`What was done on ${item.unit_number} ${item.blind_label}`}
            />
          </>
        )}
        {!fixed && (
          <>
            <Chips
              options={CANT_REASONS}
              note={item.fix_note}
              onToggle={(chip) => edit(item.id, { fix_note: toggleQuickNote(item.fix_note, chip) })}
            />
            <NoteBox
              value={item.fix_note}
              onChange={(v) => edit(item.id, { fix_note: v })}
              placeholder="Why not?"
              label={`Why ${item.unit_number} ${item.blind_label} couldn't be fixed`}
            />
          </>
        )}
      </article>
    );
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
          className="min-h-12 rounded-xl border border-amber-300 bg-amber-50 px-4 py-2 text-left text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200"
        >
          {plural(newSeeds.length, "new deficiency", "new deficiencies")} on these floors since this started.{" "}
          <span className="font-semibold underline">Add to the batch</span>
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

      {shown.length === 0 && !(filter === "todo" && counts.total > 0 && counts.open === 0) && (
        <p className="py-6 text-center text-sm text-neutral-500">Nothing here yet.</p>
      )}

      {groups.map((g) => (
        <section key={g.key} className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold text-neutral-500">{g.title}</h2>
          {g.items.map(card)}
        </section>
      ))}

      {counts.total > 0 && counts.open === 0 && (
        <button
          type="button"
          id="fix-all-done"
          onClick={goToBill}
          disabled={fixesToBill === 0}
          className="min-h-12 rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-2 text-left text-sm font-medium text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200"
        >
          All {counts.total} done{counts.cant > 0 && <> · {counts.cant} couldn&apos;t fix</>}.
          {fixesToBill > 0 && (
            <>
              {" "}
              <span className="font-semibold underline">Bill {fixesLabel} ↓</span>
            </>
          )}
        </button>
      )}

      {/* The money, once, at the end: a rate, what each fixed blind charges
          for, and the invoice button — in the page rather than the bottom
          bar, which hides while the keyboard is up for the rate. */}
      <section
        id="bill"
        aria-labelledby="bill-heading"
        className="mt-2 flex scroll-mt-4 flex-col gap-3 rounded-xl border border-neutral-200 p-4 dark:border-neutral-800"
      >
        <div>
          <h2 id="bill-heading" className="font-semibold">
            Bill these fixes
          </h2>
          <div className="text-sm text-neutral-600 dark:text-neutral-300">
            {toBill.length > 0
              ? `${toBill.length} fixed, not billed yet`
              : billRows.length > 0
                ? "Nothing fixed is set to charge."
                : counts.fixed > 0
                  ? "Everything fixed is billed."
                  : "Tick blinds off as you fix them; they bill from here."}
          </div>
        </div>

        {billedOn.map((invId) => (
          <Link
            key={invId}
            href={`/project/${projectId}/invoice/${invId}?from=fixes/${batch.id}`}
            className="flex min-h-11 items-center justify-between gap-3 rounded-lg bg-neutral-50 px-3 text-sm active:bg-neutral-100 dark:bg-neutral-900 dark:active:bg-neutral-800"
          >
            <span>Billed on invoice {invoiceNumber(invId)}</span>
            <span className="font-medium text-blue-600">Open</span>
          </Link>
        ))}

        <label className="flex items-center justify-between gap-3">
          <span className="text-sm">
            Charge per fix
            <span className="block text-xs text-neutral-500">One fix = one panel worked on</span>
          </span>
          <span className="flex items-center gap-1">
            <span className="text-neutral-500">$</span>
            <input
              ref={rateInput}
              inputMode="decimal"
              value={rateText}
              onChange={(e) => void handleRate(e.target.value)}
              placeholder="0.00"
              aria-label="Charge per fix in dollars"
              className="min-h-11 w-28 rounded-lg border border-neutral-300 px-3 text-right dark:border-neutral-700 dark:bg-neutral-900"
            />
          </span>
        </label>

        {billRows.length > 0 && (
          <div className="flex flex-col">
            <div className="flex items-end gap-2 pb-1 text-xs text-neutral-500">
              <span className="flex-1">Fixed</span>
              <span className="w-[7.5rem] text-center">Charge for panels</span>
              <span className="w-11 text-center">Charge</span>
            </div>
            {billRows.map((item) => {
              const what = item.fix_note.trim() || item.problem || "no note";
              const name = `${item.unit_number} ${item.blind_label}`;
              return (
                <div
                  key={item.id}
                  className="flex min-h-12 items-center gap-2 border-t border-neutral-200 py-1 dark:border-neutral-800"
                >
                  <div className="line-clamp-2 min-w-0 flex-1 text-sm leading-snug">
                    <span className="font-medium">{name}</span>
                    <span className="text-neutral-500"> · {what}</span>
                  </div>
                  {item.billable ? (
                    <>
                      <div className="flex shrink-0 items-center">
                        <button
                          type="button"
                          disabled={item.qty <= 1}
                          onClick={() => edit(item.id, { qty: item.qty - 1 })}
                          aria-label={`One fewer panel on ${name}`}
                          className="h-11 w-11 rounded-lg bg-neutral-100 text-lg disabled:opacity-40 dark:bg-neutral-800"
                        >
                          −
                        </button>
                        <span className="w-8 text-center font-medium tabular-nums" aria-label={`${item.qty} panels`}>
                          {item.qty}
                        </span>
                        <button
                          type="button"
                          onClick={() => edit(item.id, { qty: item.qty + 1 })}
                          aria-label={`One more panel on ${name}`}
                          className="h-11 w-11 rounded-lg bg-neutral-100 text-lg dark:bg-neutral-800"
                        >
                          +
                        </button>
                      </div>
                      <label className="flex h-11 w-11 shrink-0 items-center justify-center">
                        <input
                          type="checkbox"
                          className="h-6 w-6"
                          checked
                          onChange={() => edit(item.id, { billable: false })}
                          aria-label={`Charge for ${name}`}
                        />
                      </label>
                    </>
                  ) : (
                    <div className="flex shrink-0 items-center gap-1">
                      <span className="w-20 text-right text-xs leading-tight text-neutral-500">
                        {item.fault === "measure" ? "Our error — not charged" : "Not charged"}
                      </span>
                      <button
                        type="button"
                        onClick={() => edit(item.id, { billable: true })}
                        className="min-h-11 rounded-lg px-2 text-sm font-medium text-blue-600"
                      >
                        Charge anyway
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {toBill.length > 0 && (
          <div className="flex items-baseline justify-between gap-2 border-t border-neutral-200 pt-2 font-semibold dark:border-neutral-800">
            <span>{fixesLabel}</span>
            <span className="tabular-nums">
              {rate !== null ? `${formatCents(fixesToBill * rate)} + HST` : "set a charge per fix"}
            </span>
          </div>
        )}

        <button
          type="button"
          onClick={() => void handleInvoice()}
          disabled={toBill.length === 0 || rate === null || billing}
          className="min-h-12 rounded-xl bg-blue-600 text-base font-semibold text-white active:bg-blue-700 disabled:bg-neutral-200 disabled:text-neutral-500 dark:disabled:bg-neutral-800 dark:disabled:text-neutral-400"
        >
          {billing
            ? "Making invoice…"
            : toBill.length === 0
              ? "Nothing fixed to bill yet"
              : rate === null
                ? "Set a charge per fix to bill"
                : `Make invoice — ${fixesLabel}`}
        </button>
      </section>

      <div className="flex flex-col pb-2">
        {confirmDelete ? (
          <div className="flex flex-col gap-2 text-sm">
            <span>Delete this deficiency batch? The blinds keep their deficiencies; invoices stay.</span>
            <span className="flex gap-2">
              <button
                type="button"
                onClick={() => void handleDelete()}
                className="min-h-11 rounded-lg bg-rose-600 px-4 font-semibold text-white"
              >
                Delete
              </button>
              <button
                type="button"
                onClick={() => setConfirmDelete(false)}
                className="min-h-11 rounded-lg bg-neutral-100 px-4 dark:bg-neutral-800"
              >
                Keep
              </button>
            </span>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmDelete(true)}
            className="min-h-11 self-start text-sm text-rose-600"
          >
            Delete this deficiency batch
          </button>
        )}
      </div>

      <BottomBar>
        <button
          type="button"
          onClick={goToBill}
          disabled={toBill.length === 0}
          className="min-h-14 flex-1 rounded-xl bg-blue-600 text-base font-semibold text-white active:bg-blue-700 disabled:bg-neutral-300 disabled:text-neutral-600 dark:disabled:bg-neutral-800 dark:disabled:text-neutral-400"
        >
          {toBill.length === 0 ? "Nothing fixed to bill yet" : `Bill ${fixesLabel} ↓`}
        </button>
      </BottomBar>
    </main>
  );
}
