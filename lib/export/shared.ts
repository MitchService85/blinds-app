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
import type {
  ControlOverride,
  Deduct,
  FloorDefaults,
  MountType,
  StoredMountType,
  UnitStatus,
} from "../types";

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
  /** Per-panel control side, parallel to `widths`. See WindowRecord. */
  panel_controls?: ControlOverride[] | null;
  /** Per-window mount override; null/absent inherits the floor default. */
  mount_override?: StoredMountType;
  /** Per-window tight override; null/absent inherits the floor's tight. */
  tight_override?: boolean | null;
  deduct: Deduct;
  /** Chain length in whole inches -> the template's Chain column. */
  chain_length?: number | null;
  longer_chain: boolean;
  /** Per-window motorization override; null/absent inherits the floor. */
  motorized_override?: boolean | null;
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

/**
 * Normalise a stored mount value. "inside_tight" predates the mount/tight
 * split and meant only "TIGHT MEASURES", never an inside mount, so it
 * resolves to no mount at all — its tight half is picked up by isTightMount.
 */
export function normalizeMount(m: StoredMountType | undefined): MountType {
  if (m === "inside_tight" || m === undefined) return null;
  return m;
}

/** True when a stored mount value carried the legacy tight meaning. */
export function isTightMount(m: StoredMountType | undefined): boolean {
  return m === "inside_tight";
}

/** Resolve a floor's mount. */
export function effectiveMount(defaults: Pick<FloorDefaults, "mount">): MountType {
  return normalizeMount(defaults.mount);
}

/** Resolve whether a floor is measured tight, honouring the legacy encoding. */
export function effectiveTight(defaults: Pick<FloorDefaults, "tight" | "mount">): boolean {
  return defaults.tight === true || isTightMount(defaults.mount);
}

/** Resolve a window's mount: its own override wins, else the floor's. */
export function windowMount(
  defaults: Pick<FloorDefaults, "mount">,
  override: StoredMountType | undefined
): MountType {
  const own = normalizeMount(override);
  return own ?? effectiveMount(defaults);
}

/** Resolve a window's tight: explicit override wins, then legacy, then floor. */
export function windowTight(
  defaults: Pick<FloorDefaults, "tight" | "mount">,
  override: StoredMountType | undefined,
  tightOverride: boolean | null | undefined
): boolean {
  if (tightOverride === true || tightOverride === false) return tightOverride;
  if (isTightMount(override)) return true;
  return effectiveTight(defaults);
}

/**
 * Control side for one panel of a window: the panel's own setting wins, then
 * the whole-window override, then the floor's drive side. Single-panel
 * windows simply never carry panel_controls.
 */
export function panelControl(
  w: Pick<ExportWindow, "control_override" | "panel_controls">,
  panelIndex: number,
  floorDrive: "L" | "R"
): "L" | "R" {
  return w.panel_controls?.[panelIndex] ?? w.control_override ?? floorDrive;
}

/**
 * Resolve whether a window is motorized: its own override wins, else the
 * floor's setting.
 */
export function effectiveMotorized(
  defaults: Pick<FloorDefaults, "motorized">,
  override?: boolean | null
): boolean {
  if (override === true || override === false) return override;
  return defaults.motorized === true;
}

/**
 * Fabric-code block with the legacy keys folded in. The block was re-keyed
 * 2026-08-20 (bed/liv/studio/kitchen -> mbed/liv/bed/kit/stu) and live rows
 * were migrated, but a row written by a phone still on the old bundle can
 * win last-write-wins with the old keys, and export snapshots recorded
 * before the rename carry them too. Old "bed" was the bedroom fabric (-> bed),
 * "kitchen" -> kit, "studio" -> stu; a new-key value always wins.
 */
export function normalizeColorCodes(
  raw: Partial<Record<string, string>> | undefined
): FloorDefaults["color_codes"] {
  const r = raw ?? {};
  return {
    mbed: r.mbed ?? "",
    liv: r.liv ?? "",
    bed: r.bed ?? "",
    kit: r.kit || r.kitchen || "",
    stu: r.stu || r.studio || "",
  };
}

/** Blinds one window represents: one per panel, times the quantity. */
export function windowBlindCount(
  w: Pick<ExportWindow, "widths" | "quantity">
): number {
  return w.widths.length * (w.quantity ?? 1);
}

/** Notes-column text for a mount, matching the corpus of accepted files. */
const MOUNT_TEXT: Record<Exclude<MountType, null>, string> = {
  inside: "Inside Mount",
  outside: "Outside Mount",
};

/** Leads the Notes column on 528 of the corpus's 579 annotated rows. */
const TIGHT_TEXT = "TIGHT MEASURES";

/**
 * Build the notes string for a single window row: mount text (override or
 * floor default), then floor extra note, then the per-window note, then
 * "LONGER CHAIN" when flagged — each piece separated by ". ".
 */
export function buildNoteString(
  defaults: Pick<FloorDefaults, "tight" | "mount" | "extra_note" | "motorized" | "chain_type">,
  windowNote: string,
  longerChain: boolean,
  mountOverride?: StoredMountType,
  opts?: {
    /** Per-window tight override. */
    tightOverride?: boolean | null;
    /** Per-window motorization override. */
    motorizedOverride?: boolean | null;
    /**
     * Chain length in inches. When set it goes in the Chain column instead,
     * so "LONGER CHAIN" is dropped from the note — the number says it better.
     */
    chainLength?: number | null;
  }
): string {
  let note = "";
  const append = (piece: string) => {
    if (!piece) return;
    note = note ? `${note}. ${piece}` : piece;
  };

  // Tight leads, as it has on every file the factory has accepted.
  if (windowTight(defaults, mountOverride, opts?.tightOverride)) append(TIGHT_TEXT);

  const mount = windowMount(defaults, mountOverride);
  if (mount) append(MOUNT_TEXT[mount]);

  if (effectiveMotorized(defaults, opts?.motorizedOverride)) append("MOTORIZED");
  append(defaults.extra_note);
  append(windowNote);
  if (defaults.chain_type) append(`${defaults.chain_type} chain`);

  const hasLength = typeof opts?.chainLength === "number" && opts.chainLength > 0;
  if (longerChain && !hasLength) append("LONGER CHAIN");

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
