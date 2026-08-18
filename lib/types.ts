// Data model per docs/superpowers/specs/2026-08-12-measure-app-design.md
// All rows carry id (uuid), updated_at (ISO string), deleted (bool) for sync.

export interface SyncedRow {
  id: string;
  updated_at: string;
  deleted: boolean;
}

export type BuildingType = "residential" | "commercial";

export interface Project extends SyncedRow {
  name: string;
  address: string;
  building_type: BuildingType;
  /** Room-tag chip set for this project, e.g. ["LR", "BR", "MBR", "Kit", ...] */
  tag_chips: string[];
}

/**
 * How the blinds meet the frame — the first thing in every commercial
 * file's Notes column ("Inside Mount", "Outside Mount", "TIGHT MEASURES").
 * null = don't note anything (matches jobs like Alcon that never say).
 */
export type MountType = null | "inside_tight" | "inside" | "outside";

export interface FloorDefaults {
  /** Reverse roll -> exports as "Rev" */
  roll: boolean;
  /** Default drive/control side */
  drive: "L" | "R";
  /**
   * Legacy flag kept for rows written before `mount` existed:
   * tight=true meant what mount="inside_tight" means now. Readers use
   * `mount ?? (tight ? "inside_tight" : null)`; writers keep both in sync.
   */
  tight: boolean;
  /** Mounting type noted on every exported row. Absent on old rows. */
  mount?: MountType;
  /** Extra note applied to every window on this floor, e.g. "DRILL HOLES IN FASCIA" */
  extra_note: string;
  /** D value shown in export header, e.g. "1/2" */
  d_value: string;
  /** Fabric color codes for the header block */
  color_codes: {
    bed: string;
    liv: string;
    studio: string;
    kitchen: string;
  };
}

export interface Floor extends SyncedRow {
  project_id: string;
  label: string;
  defaults: FloorDefaults;
  /** Factory order number for this floor's batch — shown in the header for invoicing (Mike). */
  order_number: string;
  /** Number of site trips for this floor — invoicing input (Mike). */
  trips: number | null;
}

export type UnitStatus = "active" | "na" | "done";

/** Install lifecycle: null = not started, "staged" = 🟢 ready/handoff, "done" = ✅ */
export type InstallStatus = null | "staged" | "done";

export interface Unit extends SyncedRow {
  floor_id: string;
  number: string;
  status: UnitStatus;
  /**
   * Free-text field note for the unit — punch-list reality from the job site:
   * "shim", "needs fascia", "PRIORITY", swap tracking. Not exported to the
   * factory spreadsheet.
   */
  note: string;
  /** Install progress, independent of measure status. Both steps optional. */
  install: InstallStatus;
  /**
   * ⚠️ yellow ball: install blocked by an issue (note explains). Overrides the
   * install color until cleared; can be set at any install state.
   */
  install_blocked: boolean;
  sort_order: number;
}

export type Deduct = null | "Dl" | "Dr" | "D";
export type ControlOverride = null | "L" | "R";

export interface WindowRecord extends SyncedRow {
  unit_id: string;
  /** Room tag, e.g. "LR", "BR" */
  tag_base: string;
  /** 0 = unnumbered (single window of this tag_base in the unit) */
  tag_index: number;
  /**
   * Panel widths in integer sixteenths of an inch, left to right.
   * Most windows have one panel; bay windows (e.g. 44 Charles) have 3 panels
   * sharing one tag/height/options — export emits one row per panel with the
   * same tag.
   */
  widths: number[];
  /** Height in integer sixteenths of an inch */
  height: number;
  /**
   * How many identical blinds this row represents (Cleveland Clinic style:
   * "43 1/8 x 83 x13"). Exports to the template's Q column; 1 = Q left empty.
   */
  quantity: number;
  control_override: ControlOverride;
  /**
   * Per-window mount override (20 Victoria mixes Tight and Finished on one
   * floor). null/absent = inherit the floor's mount.
   */
  mount_override?: MountType;
  deduct: Deduct;
  longer_chain: boolean;
  note: string;
  sort_order: number;
}

/**
 * A job-site photo attached to a unit's note ("here's the issue I mean").
 * The image itself is stored inline as a compressed JPEG data URL (~150-250KB
 * at 1280px): it rides the existing row sync — offline-first, last-write-wins,
 * visible on the whole crew's phones — with no separate blob-storage upload
 * path to fail in a dead zone.
 */
export interface UnitPhoto extends SyncedRow {
  unit_id: string;
  /** data:image/jpeg;base64,... */
  data: string;
}

/**
 * A record of one export of a floor to the factory workbook.
 *
 * Stores the ExportInput that produced the file rather than the .xlsx bytes:
 * buildWorkbook is a pure function, so the snapshot both regenerates the
 * byte-identical workbook on demand ("what did we send on the 12th?") and
 * supports a structural, window-by-window diff against the next export.
 * Saved bytes would only tell us that something changed, never what.
 *
 * The type-only import below is erased at compile time, so this does not
 * create a runtime cycle with lib/export/exporter.ts.
 */
export interface ExportRecord extends SyncedRow {
  floor_id: string;
  /** ISO timestamp of when the workbook was generated. */
  exported_at: string;
  filename: string;
  /** Blind count at export time (panels x quantity), shown in the history list. */
  blind_count: number;
  /** The exact input passed to buildWorkbook, carrying row ids for diffing. */
  input: import("./export/exporter").ExportInput;
}
