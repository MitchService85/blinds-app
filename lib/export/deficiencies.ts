// The deficiency (punch-list) export: every flagged blind on the chosen
// floors, one row PER PANEL, for the PM to approve and the factory to act on.
//
// Pure — no ExcelJS here (see deficiencies-xlsx.ts), so the export screen can
// count rows and preview without loading the workbook library.
//
// Field rule (Mike, 2026-10-03): a bay goes to the factory one panel per line,
// panels left to right, and the middle panel never gets a note. Crews write
// "left side no deduct, right side shim and 1/4 deduct" against the whole bay;
// this splits that sentence onto the two outer panels.
import { formatFraction } from "../fractions";
import { panelDeduct, windowTagLabel } from "./shared";
import type { Deduct, IssueFault } from "../types";

export interface DeficiencyWindow {
  tag_base: string;
  tag_index: number;
  widths: number[];
  height: number;
  deduct: Deduct;
  issue_note: string;
  issue_fault: IssueFault;
  issue_recut: boolean;
  sort_order: number;
}

export interface DeficiencyUnit {
  number: string;
  sort_order: number;
  windows: DeficiencyWindow[];
}

export interface DeficiencyFloor {
  label: string;
  units: DeficiencyUnit[];
}

export interface DeficiencyRow {
  floor: string;
  unit: string;
  blind: string;
  /** "single", "1 of 3 (left)", "3 of 3 (right)", or "2 of 3" for a whole-bay note. */
  panel: string;
  width: string;
  height: string;
  /** Deduct as ordered for THIS panel (Dl / Dr / ""), from the same rule the factory sheet uses. */
  deduct_ordered: string;
  correction: string;
  fault: string;
  recut: boolean;
  /** True when the note named no side on a bay and was applied to both outer panels. */
  assumed: boolean;
}

export function hasIssue(w: Pick<DeficiencyWindow, "issue_note" | "issue_fault" | "issue_recut">): boolean {
  return w.issue_note.trim() !== "" || w.issue_fault !== null || w.issue_recut;
}

/**
 * One clause of a field note, in factory wording. Keeps anything that is not
 * about deducts verbatim ("Missing pull tabs"), so nothing the crew wrote is
 * lost — only the side words and filler come out.
 */
export function tidyClause(clause: string): string {
  let s = clause.toLowerCase().replace(/[”“]/g, '"');
  s = s.replace(/\b(left|right|both)\b/g, " ");
  s = s.replace(/\b(side|sides|blind|need|needs|and|on|the)\b/g, " ");
  s = s.replace(/reduction|deduction/g, "deduct");
  s = s.replace(/1\/4"?/g, "1/4");
  s = s.replace(/\s+/g, " ").trim().replace(/^[,\s]+|[,\s]+$/g, "");
  if (!s) return "";
  const shim = s.includes("shim");
  let core: string;
  if (/\bno deduct\b/.test(s)) core = "no deduct";
  else if (s.includes("1/4")) core = "1/4 deduct";
  else core = s.replace(/\bshim\b/, "").replace(/\s+/g, " ").trim().replace(/^,|,$/g, "");
  const out = [shim ? "shim" : null, core].filter(Boolean).join(", ");
  return out.charAt(0).toUpperCase() + out.slice(1);
}

/**
 * Split a bay's note onto its panels. Returns a map of panel index -> wording
 * plus whether a side had to be assumed. A note that names no side applies to
 * both outer panels when it is about deducts (that is where fabric is
 * trimmed) and to every panel otherwise (pull tabs, chains, fabric flaws).
 */
export function splitNoteByPanel(
  note: string,
  panelCount: number
): { byPanel: Map<number, string>; assumed: boolean } {
  const byPanel = new Map<number, string>();
  const n = note.trim();
  if (panelCount <= 1) {
    if (n) byPanel.set(0, n.charAt(0).toUpperCase() + n.slice(1));
    return { byPanel, assumed: false };
  }
  const lower = n.toLowerCase();
  const first = 0;
  const last = panelCount - 1;
  if (/\bboth\b/.test(lower)) {
    const c = tidyClause(lower);
    byPanel.set(first, c);
    byPanel.set(last, c);
    return { byPanel, assumed: false };
  }
  const clauses = lower.split(/,|;|\band\b(?=\s*(left|right))/).filter((c) => c && c.trim());
  let named = false;
  for (const c of clauses) {
    if (/\bleft\b/.test(c)) {
      byPanel.set(first, tidyClause(c));
      named = true;
    } else if (/\bright\b/.test(c)) {
      byPanel.set(last, tidyClause(c));
      named = true;
    }
  }
  if (named) return { byPanel, assumed: false };

  const c = tidyClause(lower);
  if (/deduct|reduction|shim/.test(lower)) {
    byPanel.set(first, c);
    byPanel.set(last, c);
  } else {
    for (let i = 0; i < panelCount; i++) byPanel.set(i, c);
  }
  return { byPanel, assumed: true };
}

export function buildDeficiencyRows(floors: DeficiencyFloor[]): DeficiencyRow[] {
  const rows: DeficiencyRow[] = [];
  for (const floor of floors) {
    const units = [...floor.units].sort((a, b) => a.sort_order - b.sort_order);
    for (const unit of units) {
      const windows = [...unit.windows].filter(hasIssue).sort((a, b) => a.sort_order - b.sort_order);
      for (const w of windows) {
        const n = w.widths.length;
        const { byPanel, assumed } = splitNoteByPanel(w.issue_note, n);
        // A fault or recut flag with no note still needs a line.
        if (byPanel.size === 0) byPanel.set(0, "");
        for (const [i, correction] of [...byPanel.entries()].sort((a, b) => a[0] - b[0])) {
          const side = n > 1 ? (i === 0 ? " (left)" : i === n - 1 ? " (right)" : "") : "";
          rows.push({
            floor: floor.label,
            unit: unit.number,
            blind: windowTagLabel(w),
            panel: n > 1 ? `${i + 1} of ${n}${assumed && byPanel.size === n ? "" : side}` : "single",
            width: formatFraction(w.widths[i]),
            height: formatFraction(w.height),
            deduct_ordered: panelDeduct(w.deduct, i, n) ?? "",
            correction,
            fault: w.issue_fault ?? "",
            recut: w.issue_recut,
            assumed,
          });
        }
      }
    }
  }
  return rows;
}

export const DEFICIENCY_HEADERS = [
  "Floor",
  "Unit",
  "Blind",
  "Panel",
  "Width (in)",
  "Height (in)",
  "Deduct as ordered",
  "Correction",
  "Fault",
  "Recut",
  "PM approved",
  "Factory action",
] as const;

export function rowCells(r: DeficiencyRow): (string | boolean)[] {
  return [
    r.floor, r.unit, r.blind, r.panel, r.width, r.height, r.deduct_ordered,
    r.correction, r.fault, r.recut ? "yes" : "", "", "",
  ];
}

export function suggestedDeficiencyFilename(projectName: string, floorLabels: string[], date: string): string {
  const scope = floorLabels.length === 1 ? floorLabels[0] : `${floorLabels.length} floors`;
  return `${projectName} - Deficiencies - ${scope} - ${date}.xlsx`.replace(/[\\/:*?"<>|]+/g, "-");
}
