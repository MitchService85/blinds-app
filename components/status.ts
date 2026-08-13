import type { UnitStatus } from "@/lib/types";

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
  na: "bg-neutral-100 text-neutral-400 border-neutral-200 line-through dark:bg-neutral-800/60 dark:text-neutral-600 dark:border-neutral-800",
};
