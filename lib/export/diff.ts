// Structural diff between two export snapshots of the same floor.
//
// Exports are the moment measurements leave our hands, so the question that
// matters later is never "did the file change" but "which blind changed, and
// from what to what". Because we snapshot the ExportInput rather than the
// .xlsx bytes (see ExportRecord in lib/types.ts), we can answer that exactly.
//
// Two comparisons happen here:
//   - per window: added / removed / changed, matched by row id where both
//     snapshots carry one, else by unit + tag + ordinal for older records.
//   - per floor: the defaults that silently rewrite every row. A D value
//     going from 1/2 to 1/4 changes the finished size of every blind on the
//     floor while touching only one header cell, so it must be surfaced.
import { floorToEighth, formatFraction } from "../fractions";
import type { MountType } from "../types";
import {
  effectiveMotorized,
  effectiveMount,
  effectiveTight,
  normalizeMount,
  windowTagLabel,
  type ExportInput,
  type ExportUnit,
  type ExportWindow,
} from "./shared";

export type ChangeKind = "added" | "removed" | "changed";

export interface FieldChange {
  label: string;
  from: string;
  to: string;
}

export interface WindowChange {
  kind: ChangeKind;
  unit_number: string;
  tag: string;
  /** Field-level detail; empty for added/removed rows. */
  fields: FieldChange[];
}

export interface ExportDiff {
  /** Changes to floor defaults, which rewrite every row on the floor. */
  floor: FieldChange[];
  windows: WindowChange[];
  added: number;
  removed: number;
  changed: number;
  /** True when nothing at all differs between the two snapshots. */
  identical: boolean;
}

/** One exported window, paired with the unit it belongs to. */
interface Entry {
  unit: ExportUnit;
  window: ExportWindow;
  key: string;
}

const MOUNT_LABEL: Record<string, string> = {
  inside: "Inside",
  outside: "Outside",
};

function mountLabel(m: MountType): string {
  return m ? (MOUNT_LABEL[m] ?? m) : "not noted";
}

function panelControlsLabel(c?: (string | null)[] | null): string {
  if (!c || c.length === 0 || c.every((x) => !x)) return "floor default";
  return c.map((x, i) => `p${i + 1} ${x ?? "default"}`).join(", ");
}

function chainLabel(inches?: number | null): string {
  return typeof inches === "number" && inches > 0 ? `${inches}"` : "none";
}

function motorLabel(v?: boolean | null): string {
  if (v === true) return "yes";
  if (v === false) return "no";
  return "floor default";
}

function sizeLabel(sixteenths: number): string {
  return formatFraction(floorToEighth(sixteenths));
}

function widthsLabel(widths: number[]): string {
  return widths.map(sizeLabel).join(" / ") || "none";
}

/**
 * Walk a snapshot in the same order buildWorkbook does, skipping the units it
 * skips, so the diff describes the rows that actually reached the factory.
 */
function entries(input: ExportInput): Entry[] {
  const out: Entry[] = [];
  const seen = new Map<string, number>();
  for (const unit of input.units) {
    if (unit.status === "na") continue;
    for (const window of unit.windows) {
      const tag = windowTagLabel(window);
      // Older snapshots predate row ids; fall back to a positional key that is
      // stable as long as the unit's window list keeps its shape.
      const positional = `${unit.number}|${tag}`;
      const ordinal = seen.get(positional) ?? 0;
      seen.set(positional, ordinal + 1);
      out.push({
        unit,
        window,
        key: window.id ?? `${positional}|${ordinal}`,
      });
    }
  }
  return out;
}

function compareWindows(a: ExportWindow, b: ExportWindow): FieldChange[] {
  const fields: FieldChange[] = [];
  const push = (label: string, from: string, to: string) => {
    if (from !== to) fields.push({ label, from, to });
  };

  push("Width", widthsLabel(a.widths), widthsLabel(b.widths));
  push("Height", sizeLabel(a.height), sizeLabel(b.height));
  push("Quantity", String(a.quantity ?? 1), String(b.quantity ?? 1));
  push("Deduct", a.deduct ?? "none", b.deduct ?? "none");
  push("Control", a.control_override ?? "floor default", b.control_override ?? "floor default");
  push("Control per panel", panelControlsLabel(a.panel_controls), panelControlsLabel(b.panel_controls));
  push(
    "Mount",
    a.mount_override ? mountLabel(normalizeMount(a.mount_override)) : "floor default",
    b.mount_override ? mountLabel(normalizeMount(b.mount_override)) : "floor default"
  );
  push("Tight", motorLabel(a.tight_override), motorLabel(b.tight_override));
  push("Chain length", chainLabel(a.chain_length), chainLabel(b.chain_length));
  push("Longer chain", a.longer_chain ? "yes" : "no", b.longer_chain ? "yes" : "no");
  push("Motorized", motorLabel(a.motorized_override), motorLabel(b.motorized_override));
  push("Note", a.note || "none", b.note || "none");

  return fields;
}

function compareFloors(a: ExportInput, b: ExportInput): FieldChange[] {
  const fields: FieldChange[] = [];
  const push = (label: string, from: string, to: string) => {
    if (from !== to) fields.push({ label, from, to });
  };

  push("D value", a.defaults.d_value, b.defaults.d_value);
  push("Mount", mountLabel(effectiveMount(a.defaults)), mountLabel(effectiveMount(b.defaults)));
  push(
    "Tight",
    effectiveTight(a.defaults) ? "yes" : "no",
    effectiveTight(b.defaults) ? "yes" : "no"
  );
  push("Roll", a.defaults.roll ? "reverse" : "standard", b.defaults.roll ? "reverse" : "standard");
  push("Control side", a.defaults.drive, b.defaults.drive);
  push("Floor note", a.defaults.extra_note || "none", b.defaults.extra_note || "none");
  push(
    "Motorized",
    effectiveMotorized(a.defaults) ? "yes" : "no",
    effectiveMotorized(b.defaults) ? "yes" : "no"
  );
  push("Chain type", a.defaults.chain_type || "none", b.defaults.chain_type || "none");

  const codes = ["mbed", "liv", "bed", "kit"] as const;
  for (const code of codes) {
    push(
      `${code[0].toUpperCase()}${code.slice(1)} colour`,
      a.defaults.color_codes[code] || "none",
      b.defaults.color_codes[code] || "none"
    );
  }

  return fields;
}

/**
 * Diff the previously exported snapshot (`prev`) against what would be
 * exported now (`next`). Pure — no I/O, no ordering assumptions beyond the
 * export order itself.
 */
export function diffExports(prev: ExportInput, next: ExportInput): ExportDiff {
  const before = new Map(entries(prev).map((e) => [e.key, e]));
  const after = entries(next);

  const windows: WindowChange[] = [];
  let added = 0;
  let changed = 0;

  for (const entry of after) {
    const old = before.get(entry.key);
    if (!old) {
      added++;
      windows.push({
        kind: "added",
        unit_number: entry.unit.number,
        tag: windowTagLabel(entry.window),
        fields: [],
      });
      continue;
    }
    before.delete(entry.key);
    const fields = compareWindows(old.window, entry.window);
    if (fields.length > 0) {
      changed++;
      windows.push({
        kind: "changed",
        unit_number: entry.unit.number,
        tag: windowTagLabel(entry.window),
        fields,
      });
    }
  }

  // Anything still in `before` was exported last time and is gone now.
  const removed = before.size;
  for (const leftover of before.values()) {
    windows.push({
      kind: "removed",
      unit_number: leftover.unit.number,
      tag: windowTagLabel(leftover.window),
      fields: [],
    });
  }

  const floor = compareFloors(prev, next);

  return {
    floor,
    windows,
    added,
    removed,
    changed,
    identical: floor.length === 0 && windows.length === 0,
  };
}

/** One-line summary for the floor screen, e.g. "3 changed, 1 added". */
export function summarizeDiff(diff: ExportDiff): string {
  if (diff.identical) return "no changes since";
  const parts: string[] = [];
  if (diff.changed) parts.push(`${diff.changed} changed`);
  if (diff.added) parts.push(`${diff.added} added`);
  if (diff.removed) parts.push(`${diff.removed} removed`);
  if (diff.floor.length) {
    parts.push(diff.floor.length === 1 ? "1 floor setting" : `${diff.floor.length} floor settings`);
  }
  return `${parts.join(", ")} since`;
}
