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

export interface FloorDefaults {
  /** Reverse roll -> exports as "Rev" */
  roll: boolean;
  /** Default drive/control side */
  drive: "L" | "R";
  /** Tight measures note flag */
  tight: boolean;
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
}

export type UnitStatus = "active" | "na" | "done";

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
  control_override: ControlOverride;
  deduct: Deduct;
  longer_chain: boolean;
  note: string;
  sort_order: number;
}
