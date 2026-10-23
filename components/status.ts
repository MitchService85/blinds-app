import type { Deficiency, InstallStatus, Unit, UnitStatus, WindowRecord } from "@/lib/types";
import { deficiencyOpen, legacyIssueOpen } from "@/lib/issues";

/**
 * The stored UnitStatus enum only has three values (active | na | done).
 * "Not started" vs "in progress" (spec's floor-grid coloring) is derived
 * from whether the unit has any windows yet, not stored separately.
 */
export type DerivedUnitState = "not_started" | "in_progress" | "done" | "na";

export function deriveUnitState(status: UnitStatus, windowCount: number): DerivedUnitState {
  if (status === "na") return "na";
  if (status === "done") return "done";
  return windowCount > 0 ? "in_progress" : "not_started";
}

export const UNIT_STATE_LABEL: Record<DerivedUnitState, string> = {
  not_started: "Not started",
  in_progress: "In progress",
  done: "Done",
  na: "N/A",
};

export const UNIT_STATE_TILE_CLASSES: Record<DerivedUnitState, string> = {
  not_started:
    "bg-neutral-50 text-neutral-500 border-neutral-300 dark:bg-neutral-900 dark:text-neutral-400 dark:border-neutral-700",
  in_progress:
    "bg-amber-100 text-amber-900 border-amber-300 dark:bg-amber-900/40 dark:text-amber-200 dark:border-amber-700",
  done: "bg-emerald-100 text-emerald-900 border-emerald-400 dark:bg-emerald-900/40 dark:text-emerald-200 dark:border-emerald-700",
  na: "bg-neutral-100 text-neutral-500 border-neutral-200 line-through dark:bg-neutral-800/60 dark:text-neutral-600 dark:border-neutral-800",
};

// ---------------------------------------------------------------------------
// Install mode (see spec: Install mode)
//
// Unit.install / Unit.install_blocked were added after rows already existed
// in IndexedDB, so a unit written before the migration lacks these fields at
// runtime even though the Unit type claims they're always present. Every
// read goes through installOf/blockedOf below rather than touching
// unit.install / unit.install_blocked directly, so that defensive fallback
// can never be forgotten at a call site.
// ---------------------------------------------------------------------------

export function installOf(unit: Pick<Unit, "install">): InstallStatus {
  return unit.install ?? null;
}

export function blockedOf(unit: Pick<Unit, "install_blocked">): boolean {
  return unit.install_blocked ?? false;
}

export function lockedOf(unit: Pick<Unit, "locked">): boolean {
  return unit.locked ?? false;
}

/**
 * Units with something still wrong in them: a blind flagged ⚠ that nobody has
 * cleared, or a PM deficiency still open.
 */
export function unitsWithOutstanding(
  windows: Pick<WindowRecord, "unit_id" | "deleted" | "issue_note" | "issue_fault" | "issue_recut" | "issue_fixed_at">[],
  deficiencies: Pick<Deficiency, "unit_id" | "status" | "deleted">[] = []
): Set<string> {
  const out = new Set<string>();
  for (const w of windows) {
    if (w.deleted) continue;
    // The window's old single-issue form, until it is moved to a deficiency.
    if (legacyIssueOpen(w)) out.add(w.unit_id);
  }
  for (const d of deficiencies) {
    if (deficiencyOpen(d)) out.add(d.unit_id);
  }
  return out;
}

/**
 * Blocked as the grid shows it: set by hand, or installed with a deficiency
 * still outstanding (Mitch, 2026-10-16: "the unit is not complete if there is
 * still an outstanding deficiency"). Derived rather than stored, so fixing
 * the last flag turns the unit back green with nothing to remember to undo.
 *
 * Only once install has started: a unit not yet installed is not complete
 * anyway, and a ⚠ on a blind still to be installed is often the reorder note
 * for it (44 Charles Batch 5) rather than a fault in place.
 */
export function isBlocked(
  unit: Pick<Unit, "install" | "install_blocked">,
  outstanding = false
): boolean {
  return blockedOf(unit) || (outstanding && installOf(unit) !== null);
}

export type InstallTileState = "na" | "locked" | "blocked" | "done" | "staged" | "not_started";

/** N/A wins, then locked (we never got in), then blocked, then install state. */
export function deriveInstallState(
  unit: Pick<Unit, "status" | "install" | "install_blocked" | "locked">,
  outstanding = false
): InstallTileState {
  if (unit.status === "na") return "na";
  if (lockedOf(unit)) return "locked";
  if (isBlocked(unit, outstanding)) return "blocked";
  const install = installOf(unit);
  if (install === "done") return "done";
  if (install === "staged") return "staged";
  return "not_started";
}

export const INSTALL_STATE_TILE_CLASSES: Record<InstallTileState, string> = {
  na: UNIT_STATE_TILE_CLASSES.na,
  not_started: UNIT_STATE_TILE_CLASSES.not_started,
  locked:
    "bg-violet-100 text-violet-900 border-violet-400 dark:bg-violet-900/40 dark:text-violet-200 dark:border-violet-600",
  blocked:
    "bg-amber-100 text-amber-900 border-amber-400 dark:bg-amber-900/40 dark:text-amber-200 dark:border-amber-600",
  staged:
    "bg-white text-emerald-700 border-2 border-emerald-500 dark:bg-neutral-900 dark:text-emerald-300 dark:border-emerald-500",
  done: "bg-emerald-500 text-white border-emerald-600 dark:bg-emerald-600 dark:border-emerald-500",
};
