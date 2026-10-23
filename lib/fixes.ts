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
