// Data model per docs/superpowers/specs/2026-08-12-measure-app-design.md
// All rows carry id (uuid), updated_at (ISO string), deleted (bool) for sync.

export interface SyncedRow {
  id: string;
  updated_at: string;
  deleted: boolean;
}

/**
 * A row owned by exactly one company. Optional because it is stamped by
 * lib/db.ts's write funnel rather than by callers, and because rows written
 * before a device resolved its membership are backfilled on push.
 *
 * `companies` deliberately does NOT extend this: it is the tenant itself and
 * is keyed by `id`.
 */
export interface TenantRow extends SyncedRow {
  company_id?: string;
}

export type BuildingType = "residential" | "commercial";

/**
 * Job money for a project (see docs/superpowers/plans/2026-08-21-job-money-plan.md).
 *
 * Danny prices the contract off plan takeoffs and locks it BEFORE the crew
 * measures, so there is no quote generation here: contract_cents is a recorded
 * fact, quoted_blind_count is his takeoff to compare actuals against, and the
 * per-unit rates are the crew's own billables on top. All money is integer
 * cents (same no-floats rule as integer sixteenths). A null rate means that
 * line simply isn't billed on this job — e.g. install already inside Danny's
 * contract.
 */
export interface ProjectPricing {
  /** Danny's locked contract price. */
  contract_cents: number | null;
  /** Danny's blind count from the plan takeoff, for variance vs actuals. */
  quoted_blind_count: number | null;
  removal_per_blind_cents: number | null;
  install_per_blind_cents: number | null;
  /** Upcharge per motorized blind (floor default + per-window override). */
  motorized_premium_cents: number | null;
  /** Charge per recorded site trip (floors.trips). */
  trip_charge_cents: number | null;
  note: string;
}

export interface Project extends TenantRow {
  name: string;
  address: string;
  building_type: BuildingType;
  /** Room-tag chip set for this project, e.g. ["LR", "BR", "MBR", "Kit", ...] */
  tag_chips: string[];
  /** Job money. Absent/null = feature not set up for this project. */
  pricing?: ProjectPricing | null;
}

/**
 * Where the blind sits relative to the opening. null = don't note anything
 * (matches jobs like Alcon that never say).
 *
 * Deliberately independent of `tight`: mount is *where it sits*, tight is
 * *how it was measured*, and a window can be both (inside mount, measured
 * tight). They were one 4-way control until 2026-08-18 and no file in the
 * corpus ever combined them, but that was the control's limitation, not a
 * real constraint.
 */
export type MountType = null | "inside" | "outside";

/**
 * Values that may still be sitting in stored rows. "inside_tight" predates
 * the mount/tight split and meant only "TIGHT MEASURES" — it never implied an
 * inside mount — so readers normalise it to { mount: null, tight: true }.
 */
export type StoredMountType = MountType | "inside_tight";

/**
 * How the opening was measured — the factory's two conventions (Annie at
 * Elite, 2026-08-26): "tight" = measured tight to the opening, the factory
 * takes its deduction; "finished" = the number already IS the finished blind
 * size. null = don't note anything. Exports as "TIGHT MEASURES" /
 * "FINISHED MEASURES" leading the Notes column.
 */
export type MeasureType = null | "tight" | "finished";

export interface FloorDefaults {
  /** Reverse roll -> exports as "Rev" */
  roll: boolean;
  /** Default drive/control side */
  drive: "L" | "R";
  /**
   * Legacy boolean from before "finished" existed (2026-08-26), kept because
   * a phone on an older bundle only reads this. Writers keep it in sync
   * (`tight === (measure === "tight")`); readers prefer `measure` and fall
   * back here for rows written before it. Independent of `mount` since
   * 2026-08-18.
   */
  tight: boolean;
  /** How the floor was measured. Absent on rows older than 2026-08-26. */
  measure?: MeasureType;
  /** Where the blind sits, noted on every exported row. Absent on old rows. */
  mount?: StoredMountType;
  /**
   * Whole floor is motorized. The corpus records this per room/zone rather
   * than per window (Canadian Tire marks "Motorized" on a zone header covering
   * every size beneath it), so it lives here with a per-window override.
   */
  motorized?: boolean;
  /**
   * Chain type for the job, e.g. "Metal" (2000-181 University). Reaches the
   * factory through the Notes column: the template's Chain column is reserved
   * for a length per its Instructions sheet, so a type cannot go there.
   */
  chain_type?: string;
  /** Extra note applied to every window on this floor, e.g. "DRILL HOLES IN FASCIA" */
  extra_note: string;
  /** D value shown in export header, e.g. "1/2" */
  d_value: string;
  /** Fabric color codes for the header block */
  /**
   * Fabric code per room type, written into the export header block so the
   * factory knows which fabric each tagged row takes. Keyed to Mike's own
   * designations (MBR/LR/BR/K), which the factory has always processed and
   * returns labelled the same way.
   *
   * Master bedroom is its own slot as of 2026-08-20: BR and MBR both fell
   * under a single "Bed" code before, so a master bedroom could not be given
   * a different fabric. The old "Studio" slot went at the same time — nothing
   * in any job is tagged Studio.
   */
  color_codes: {
    mbed: string;
    liv: string;
    bed: string;
    kit: string;
    /**
     * Studio/bachelor. Its own fabric because the whole place doubles as the
     * bedroom, so it usually wants blackout even though no room is tagged as
     * a bedroom.
     */
    stu: string;
  };
}

export interface Floor extends TenantRow {
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

export interface Unit extends TenantRow {
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
  /**
   * Old blinds taken down in this unit/zone — a billable count (see
   * ProjectPricing.removal_per_blind_cents). Recorded per unit because that's
   * how it comes off the site walk (Four Seasons: 36/13/36/13 per side);
   * floors and the project roll up by summing. Absent on old rows = 0.
   */
  removed?: number;
  sort_order: number;
}

export type Deduct = null | "Dl" | "Dr" | "D";
export type ControlOverride = null | "L" | "R";

/**
 * Whose error a flagged blind is: the factory cut it wrong, or it was
 * measured wrong on site. Decides who pays for a recut (Mitch, 2026-08-27:
 * "if there are cuts that need to be made, they pay for it if it's their
 * error"). null = not attributed (yet).
 */
export type IssueFault = null | "factory" | "measure";

export interface WindowRecord extends TenantRow {
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
   * Per-panel control side, parallel to `widths`. Layered on top of
   * control_override, which stays the whole-window value: a panel resolves to
   * panel_controls[i] ?? control_override ?? the floor's drive side.
   *
   * Residential only in the UI. At 15 Neighborhood the left panel of a bay
   * takes left control while the other two stay default; 44 Charles is roller
   * shades pulled by hand with no chain at all, so every panel is default
   * there, and offices generally do not bother with left hand.
   */
  panel_controls?: ControlOverride[] | null;
  /**
   * "I checked this one, it's fine." Silences this window's measurement
   * warnings on the unit screen and at export. Per window on purpose, not a
   * global off switch: the bay side-panel check has caught two real miscuts,
   * so it should be dismissed one deliberate tap at a time.
   */
  checks_ack?: boolean;
  /**
   * Per-window mount override (20 Victoria mixes mount styles on one floor).
   * null/absent = inherit the floor's mount.
   */
  mount_override?: StoredMountType;
  /** Per-window tight override; null/absent inherits the floor's `tight`. */
  tight_override?: boolean | null;
  deduct: Deduct;
  /**
   * Chain length in whole inches, exported to the template's Chain column.
   * The Instructions sheet defines that column as "Chain length value (e.g.,
   * 72, 48, 60)" but no file in the corpus ever used it — lengths were typed
   * into Notes instead ("Requires 160\" chain" at Citi). null = unspecified.
   */
  chain_length?: number | null;
  /**
   * Legacy qualitative flag, superseded by chain_length. Still honoured for
   * rows written before that field existed (dozens of Arbour rows carry
   * "LONGER CHAIN" in their notes), but a window with a chain_length exports
   * the number instead of the phrase.
   */
  longer_chain: boolean;
  /** Per-window motorization override; null/absent inherits the floor. */
  motorized_override?: boolean | null;
  /**
   * Install-issue note for this one blind ("cut 1/4 short", "wrong fabric"),
   * recorded when a unit is blocked. Punch-list reality like Unit.note —
   * never exported to the factory measure sheet. Empty/absent = no issue.
   */
  issue_note?: string;
  /** Who caused the flagged issue — see IssueFault. Absent on old rows. */
  issue_fault?: IssueFault;
  /** This blind needs a recut/remake (factory pays when issue_fault is "factory"). */
  issue_recut?: boolean;
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
export interface UnitPhoto extends TenantRow {
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
export interface ExportRecord extends TenantRow {
  floor_id: string;
  /** ISO timestamp of when the workbook was generated. */
  exported_at: string;
  filename: string;
  /** Blind count at export time (panels x quantity), shown in the history list. */
  blind_count: number;
  /** The exact input passed to buildWorkbook, carrying row ids for diffing. */
  input: import("./export/exporter").ExportInput;
}

/**
 * An installer company: the tenant boundary. Everything else in this file
 * belongs to exactly one of these, and the server enforces it.
 *
 * Branding is stored here and consumed by quoting later — a quote goes out
 * under the company's name, not ours.
 */
export interface Company extends SyncedRow {
  name: string;
  /** Compressed data URL, same inline pattern as unit photos. "" = none. */
  logo: string;
  /** Hex like "#0D6E6A", or "" to use the app default. */
  accent_color: string;
  /** Free text printed at the foot of a quote. */
  quote_footer: string;
}

export type MemberRole = "admin" | "member";
/** "invited" until that address first signs in; the sign-in is the acceptance. */
export type MemberStatus = "invited" | "active";

export interface Membership extends SyncedRow {
  company_id: string;
  /** Null until the invited person first signs in. */
  user_id: string | null;
  email: string;
  role: MemberRole;
  status: MemberStatus;
}
