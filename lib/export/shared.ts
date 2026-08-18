// Pure export logic: the shapes, the trade conventions, and the string/number
// formatting that turns a measurement into a factory row.
//
// Deliberately free of any ExcelJS import. The workbook builder is heavy and
// only the export path needs it, but the floor screen wants to diff a stored
// snapshot against current data on every render (lib/export/diff.ts). Keeping
// these here means that diff costs nothing but this file.
//
// exporter.ts re-exports everything below, so existing importers are unaffected.
import { floorToEighth, toDecimal } from "../fractions";
import type { ControlOverride, Deduct, FloorDefaults, MountType, UnitStatus } from "../types";

/** A single window as consumed by the exporter (a plain, already-loaded shape —
 * not the full synced WindowRecord). Multi-panel windows (bay windows) carry
 * more than one entry in `widths`; the exporter emits one row per panel. */
export interface ExportWindow {
  /**
   * The source WindowRecord's id. Ignored by the workbook builder; present so
   * an export snapshot can be diffed against a later one by identity rather
   * than by position (see lib/export/diff.ts). Absent on hand-built fixtures.
   */
  id?: string;
  tag_base: string;
  tag_index: number;
  /** Panel widths in integer sixteenths of an inch, left to right. */
  widths: number[];
  /** Height in integer sixteenths of an inch. */
  height: number;
  /** Identical-blind multiplier (template Q column). Absent/1 = single. */
  quantity?: number;
  control_override: ControlOverride;
  /** Per-window mount override; null/absent inherits the floor default. */
  mount_override?: MountType;
  deduct: Deduct;
  longer_chain: boolean;
  note: string;
}

export interface ExportUnit {
  /** The source Unit's id. Ignored by the builder; see ExportWindow.id. */
  id?: string;
  number: string;
  status: UnitStatus;
  windows: ExportWindow[];
}

export interface ExportInput {
  project_name: string;
  floor_label: string;
  /** ISO date string, e.g. "2026-08-12". */
  export_date: string;
  defaults: FloorDefaults;
  units: ExportUnit[];
}

/** Resolve a floor's mount, reading the legacy `tight` flag for old rows. */
export function effectiveMount(defaults: Pick<FloorDefaults, "tight" | "mount">): MountType {
  return defaults.mount !== undefined ? defaults.mount : defaults.tight ? "inside_tight" : null;
}

/** Notes-column text for a mount, matching the corpus of accepted files. */
const MOUNT_TEXT: Record<Exclude<MountType, null>, string> = {
  inside_tight: "TIGHT MEASURES",
  inside: "Inside Mount",
  outside: "Outside Mount",
};

/**
 * Build the notes string for a single window row: mount text (override or
 * floor default), then floor extra note, then the per-window note, then
 * "LONGER CHAIN" when flagged — each piece separated by ". ".
 */
export function buildNoteString(
  defaults: Pick<FloorDefaults, "tight" | "mount" | "extra_note">,
  windowNote: string,
  longerChain: boolean,
  mountOverride?: MountType
): string {
  const mount = mountOverride !== undefined && mountOverride !== null
    ? mountOverride
    : effectiveMount(defaults);
  let note = mount ? MOUNT_TEXT[mount] : "";

  const append = (piece: string) => {
    if (!piece) return;
    note = note ? `${note}. ${piece}` : piece;
  };

  append(defaults.extra_note);
  append(windowNote);
  if (longerChain) append("LONGER CHAIN");

  return note;
}

/**
 * Deduct for one panel of a window. Single-panel windows carry the deduct
 * as stored. On a multi-panel bay, fabric can only be trimmed at the
 * window's outer edges: "D" (both) becomes Dl on the leftmost panel's row
 * and Dr on the rightmost; "Dl"/"Dr" land on their outer panel only; middle
 * panels never carry a deduct. (Field request from a PM at 44 Charles:
 * 1/4" off the left of the left blind and the right of the right blind.)
 */
export function panelDeduct(
  deduct: Deduct,
  panelIndex: number,
  panelCount: number
): Deduct {
  if (!deduct || panelCount <= 1) return deduct;
  const first = panelIndex === 0;
  const last = panelIndex === panelCount - 1;
  if (deduct === "D") return first ? "Dl" : last ? "Dr" : null;
  if (deduct === "Dl") return first ? "Dl" : null;
  return last ? "Dr" : null;
}

/**
 * Format a window's room-tag label from its stored tag_base/tag_index,
 * mirroring lib/tags.ts computeTagLabels' base+index semantics: tag_index 0
 * means "unnumbered" (single window of this tag_base) and renders as the
 * plain tag_base; any other tag_index renders as "{tag_base}{tag_index}".
 * The exporter trusts the stored tag_index as already-final — computed live
 * by the app (via computeTagLabels) as windows were added/removed — rather
 * than recomputing group numbering from scratch, so historical/imported data
 * with non-contiguous indices (e.g. a lone survivor renumbered to "BR22" by
 * earlier edits) round-trips exactly.
 */
export function windowTagLabel(w: Pick<ExportWindow, "tag_base" | "tag_index">): string {
  return w.tag_index === 0 ? w.tag_base : `${w.tag_base}${w.tag_index}`;
}


/** Width/height as the workbook writes them: rounded down to an eighth. */
export function exportedSize(sixteenths: number): number {
  return toDecimal(floorToEighth(sixteenths));
}
