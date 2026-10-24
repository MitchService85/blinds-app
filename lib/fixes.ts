// Deficiency fix batches: gathering flagged blinds into a list, and billing
// the ones that got fixed.
//
// Pure, like lib/invoice/draft.ts: no Dexie here, so the batch screen can
// recount on every tap and the tests can run the whole flow on plain rows.
import { makeLineItem } from "./invoice/draft";
import { splitNoteByPanel } from "./export/deficiencies";
import { windowTagLabel } from "./export/shared";
import { sortUnitsForDisplay } from "./unit-sort";
import { deficiencyOpen } from "./issues";
import type { Deficiency, FixItem, InvoiceLineItem, Unit, WindowRecord } from "./types";

/**
 * One-tap notes for what was done. Written from how 44 Charles Batch 4 is
 * actually being fixed (2026-10-16): the factory remade every blind whose
 * deduct was wrong, and the crew shims the rest on site.
 */
export const QUICK_NOTES = [
  "Shimmed",
  "New blind installed",
  "Re-hung",
  "Adjusted",
  "Pull tabs added",
] as const;

/**
 * One-tap reasons for "Can't fix", from why a blind is left for another
 * visit: the factory has to make it again, a part has to come, or nobody
 * could let us in.
 */
export const CANT_REASONS = ["Needs remake", "Needs a part", "No access"] as const;

/**
 * What was most likely done, read off the problem, so ✓ Fixed on a blind
 * with no note fills one in: a wrong deduct was fixed by the factory's new
 * blind, a shim by shimming. "" when the problem says neither.
 */
export function suggestedFixNote(problem: string): string {
  const p = problem.toLowerCase();
  const parts: string[] = [];
  if (/shim/.test(p)) parts.push("Shimmed");
  if (/deduct|reduction/.test(p)) parts.push("New blind installed");
  if (/pull tab/.test(p)) parts.push("Pull tabs added");
  return parts.join(", ");
}

/**
 * The note is still the one ✓ Fixed filled in by itself, so the screen can
 * say it was a guess — a crew member reading "New blind installed" on a blind
 * they shimmed would otherwise take it as something someone wrote.
 */
export function isGuessedNote(item: Pick<FixItem, "fix_note" | "problem">): boolean {
  const note = item.fix_note.trim();
  return note !== "" && note === suggestedFixNote(item.problem);
}

/**
 * The note a fix carries into its new status. ✓ Fixed on an empty note fills
 * in the guess; undoing it takes the guess back out (it was never written by
 * anyone, and left there it would stop the next ✓ Fixed guessing afresh), as
 * does undoing "Can't fix" when all it holds is reason chips. Anything typed
 * stays.
 */
export function noteForStatus(
  item: Pick<FixItem, "fix_note" | "problem" | "status">,
  status: FixItem["status"]
): string {
  const note = item.fix_note;
  if (status === "fixed") return note.trim() ? note : suggestedFixNote(item.problem);
  if (status === "open" && item.status === "fixed" && isGuessedNote(item)) return "";
  if (status === "open" && item.status === "cant") {
    const parts = note.split(",").map((p) => p.trim()).filter(Boolean);
    if (parts.every((p) => CANT_REASONS.some((r) => r.toLowerCase() === p.toLowerCase()))) return "";
  }
  return note;
}

/** Whether a note already carries this quick note as one of its parts. */
export function hasQuickNote(note: string, chip: string): boolean {
  const want = chip.toLowerCase();
  return note.split(",").some((p) => p.trim().toLowerCase() === want);
}

/** Tap a quick note: add it to the end, or take it out if it is there. */
export function toggleQuickNote(note: string, chip: string): string {
  const parts = note.split(",").map((p) => p.trim()).filter(Boolean);
  const want = chip.toLowerCase();
  const kept = parts.filter((p) => p.toLowerCase() !== want);
  if (kept.length === parts.length) kept.push(chip);
  return kept.join(", ");
}

/**
 * How many fixes a flagged blind bills as: one per panel worked on. "Left
 * side no deduction, right side shim" on a bay is two; a single blind is one.
 * Uses the same reading of the note as the deficiency export, so the bill and
 * the sheet the PM approved count the same panels.
 */
export function fixQtyFor(problem: string, panels: number): number {
  // Flagged by fault or recut alone: nothing says which panels, so one.
  if (!problem.trim()) return 1;
  return Math.max(1, splitNoteByPanel(problem, panels).byPanel.size);
}

export interface GatherFloor {
  id: string;
  units: Array<{ unit: Unit; windows: WindowRecord[]; deficiencies: Deficiency[] }>;
}

export type FixItemSeed = Omit<FixItem, "id" | "updated_at" | "deleted" | "batch_id" | "project_id">;

/**
 * Every open problem on a blind on these floors that is not already in a
 * batch, in walking order: floor as given, units as the grid shows them,
 * blinds as measured, a blind's problems oldest first. One entry per
 * problem, so a blind with two (cut 1/8 off, and later a stain) is two
 * things to fix. Problems about a whole unit (no blind) are not gathered.
 */
export function gatherFixItems(
  floors: GatherFloor[],
  alreadyIn: Set<string> = new Set(),
  startOrder = 0
): FixItemSeed[] {
  const out: FixItemSeed[] = [];
  let order = startOrder;
  for (const floor of floors) {
    const byId = new Map(floor.units.map((u) => [u.unit.id, u]));
    for (const unit of sortUnitsForDisplay(floor.units.map((u) => u.unit))) {
      const entry = byId.get(unit.id);
      if (!entry) continue;
      const windows = [...entry.windows].filter((w) => !w.deleted).sort((a, b) => a.sort_order - b.sort_order);
      for (const w of windows) {
        const problems = entry.deficiencies
          .filter((d) => d.window_id === w.id && deficiencyOpen(d) && !alreadyIn.has(d.id))
          .sort((a, b) => a.raised_at.localeCompare(b.raised_at));
        for (const d of problems) {
          const problem = d.note.trim();
          const fault = d.fault ?? null;
          out.push({
            floor_id: floor.id,
            unit_id: unit.id,
            window_id: w.id,
            deficiency_id: d.id,
            unit_number: unit.number,
            blind_label: windowTagLabel(w),
            panels: w.widths.length,
            problem,
            fault,
            recut: d.recut === true,
            unit_was_blocked: unit.install_blocked,
            status: "open",
            fix_note: "",
            qty: fixQtyFor(problem, w.widths.length),
            // Our own measure error is still logged — it is what the mistake
            // cost — but the customer does not pay for it.
            billable: fault !== "measure",
            fixed_at: null,
            invoice_id: null,
            sort_order: order++,
          });
        }
      }
    }
  }
  return out;
}

/** Problems already waiting in a batch — not gathered into another. */
export function inBatchIds(items: Pick<FixItem, "status" | "deficiency_id">[]): Set<string> {
  return new Set(items.filter((i) => i.status !== "fixed" && i.deficiency_id).map((i) => i.deficiency_id as string));
}

/** Already on an invoice that still exists. A deleted draft frees its fixes. */
export function isInvoiced(item: Pick<FixItem, "invoice_id">, liveInvoiceIds: Set<string>): boolean {
  return item.invoice_id !== null && liveInvoiceIds.has(item.invoice_id);
}

/**
 * Opened again (on the unit screen, or by an undo) after it was billed. The
 * invoice keeps its line — it went to the customer — so the entry keeps
 * pointing at it, and the batch says so rather than looking unbilled.
 */
export function reopenedOnInvoice(item: Pick<FixItem, "status" | "invoice_id">, liveInvoiceIds: Set<string>): boolean {
  return item.status !== "fixed" && isInvoiced(item, liveInvoiceIds);
}

/**
 * Follows its deficiency's "what was done" when that is edited elsewhere —
 * until it is on an invoice, whose line already says what was billed.
 */
export function followsDeficiencyNote(item: Pick<FixItem, "invoice_id" | "deleted">, liveInvoiceIds: Set<string>): boolean {
  return !item.deleted && !isInvoiced(item, liveInvoiceIds);
}

/**
 * Goes with its deficiency when that is removed as entered by mistake: still
 * to do (or left as can't-fix) and not on an invoice. A fixed one stays — it
 * is the record of work done, and may be what someone is about to bill.
 */
export function dropsWithDeficiency(item: Pick<FixItem, "status" | "invoice_id" | "deleted">, liveInvoiceIds: Set<string>): boolean {
  return !item.deleted && item.status !== "fixed" && !isInvoiced(item, liveInvoiceIds);
}

/** Fixed and not on an invoice yet, charged or not — the rows to bill from. */
export function fixedUnbilled(items: FixItem[], liveInvoiceIds: Set<string>): FixItem[] {
  return items.filter((i) => i.status === "fixed" && !isInvoiced(i, liveInvoiceIds));
}

/** The live invoices a batch's fixes are on, in the order first billed. */
export function billedInvoiceIds(items: Pick<FixItem, "invoice_id">[], liveInvoiceIds: Set<string>): string[] {
  const out: string[] = [];
  for (const i of items) {
    if (i.invoice_id && liveInvoiceIds.has(i.invoice_id) && !out.includes(i.invoice_id)) out.push(i.invoice_id);
  }
  return out;
}

/** How many blinds a set of deficiencies is on — "7 deficiencies on 5 blinds". */
export function blindCount(items: Pick<FixItem, "window_id">[]): number {
  return new Set(items.map((i) => i.window_id)).size;
}

/** Fixed, chargeable, and not yet billed. */
export function readyToBill(items: FixItem[], liveInvoiceIds: Set<string>): FixItem[] {
  return items.filter((i) => i.status === "fixed" && i.billable && !isInvoiced(i, liveInvoiceIds));
}

export interface FixCounts {
  open: number;
  fixed: number;
  cant: number;
  total: number;
}

export function fixCounts(items: Pick<FixItem, "status">[]): FixCounts {
  const c = { open: 0, fixed: 0, cant: 0, total: items.length };
  for (const i of items) c[i.status]++;
  return c;
}

/** "1206 LR1 — right side no deduction. Done: shimmed" */
export function fixLineLabel(item: Pick<FixItem, "unit_number" | "blind_label" | "problem" | "fix_note">): string {
  const what = item.problem ? ` — ${item.problem}` : "";
  const done = item.fix_note.trim() ? `. Done: ${item.fix_note.trim()}` : "";
  return `Fix ${item.unit_number} ${item.blind_label}${what}${done}`;
}

/** One invoice line per fixed blind: qty = panels fixed, at the batch rate. */
export function fixInvoiceLines(items: FixItem[], rateCents: number): InvoiceLineItem[] {
  return items.map((i) => makeLineItem(fixLineLabel(i), i.qty, rateCents, i.qty * rateCents));
}
