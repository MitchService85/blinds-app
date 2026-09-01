"use client";

import type { Unit, WindowRecord } from "@/lib/types";
import { blockedOf, installOf } from "./status";
import { windowBlindCount, windowTagLabel } from "@/lib/export/shared";
import { issueSummary, windowHasIssue } from "./window-issue";

export type InstallAction = "staged" | "complete" | "blocked" | "clear";

interface InstallActionSheetProps {
  unit: Unit | null;
  /** The unit's windows — flagged blind issues preview here. */
  windows?: WindowRecord[];
  onAction: (action: InstallAction) => void;
  onOpenUnit: () => void;
  onEditNote: () => void;
  onClose: () => void;
}

/**
 * Tap target for an InstallTile (see spec: Install mode). Selecting
 * Staged/Complete/Blocked/Clear writes through updateUnit (handled by the
 * floor page, which also opens the unit when Blocked is picked — that is
 * where the per-blind ⚠ flags and the unit note both live). "Open unit"
 * drills into the windows list — installers reference sizes on site.
 */
export function InstallActionSheet({
  unit,
  windows,
  onAction,
  onOpenUnit,
  onEditNote,
  onClose,
}: InstallActionSheetProps) {
  if (!unit) return null;

  const install = installOf(unit);
  const blocked = blockedOf(unit);
  const issues = (windows ?? []).filter(windowHasIssue);
  // Openings vs blinds differ on bays and repeat rows (one 3-panel bay is
  // three blinds, three sets of brackets), so both are worth stating here —
  // this sheet is what the installer opens before starting the unit.
  const blinds = (windows ?? []).reduce((n, w) => n + windowBlindCount(w), 0);
  const openings = (windows ?? []).length;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-xl bg-white p-4 dark:bg-neutral-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-1 flex items-baseline justify-between gap-2">
          <span className="text-sm font-semibold">Unit {unit.number}</span>
          {blinds > 0 && (
            <span className="shrink-0 text-xs text-neutral-500 dark:text-neutral-400">
              {blinds} blind{blinds === 1 ? "" : "s"}
              {openings !== blinds && ` · ${openings} opening${openings === 1 ? "" : "s"}`}
            </span>
          )}
        </div>

        {blocked && unit.note && (
          <div className="mb-3 rounded-lg bg-amber-50 p-2 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200">
            ⚠️ {unit.note}
          </div>
        )}

        {issues.length > 0 && (
          <div className="mb-3 flex flex-col gap-1 rounded-lg bg-amber-50 p-2 text-xs text-amber-900 dark:bg-amber-950 dark:text-amber-200">
            {issues.map((w) => (
              <div key={w.id}>
                ⚠️ {windowTagLabel(w)} — {issueSummary(w)}
              </div>
            ))}
          </div>
        )}
        {blocked && issues.length === 0 && !unit.note && (
          <div className="mb-3 text-xs text-neutral-500">
            Nothing recorded yet — <b>Open unit</b> to note it or flag the blinds.
          </div>
        )}

        <div className="flex flex-col gap-2">
          <ActionButton
            label="🟢 Staged"
            active={!blocked && install === "staged"}
            onClick={() => onAction("staged")}
          />
          <ActionButton
            label="✅ Complete"
            active={!blocked && install === "done"}
            onClick={() => onAction("complete")}
          />
          <ActionButton label="⚠️ Blocked" active={blocked} onClick={() => onAction("blocked")} />
          <ActionButton
            label="Clear"
            active={!blocked && install === null}
            onClick={() => onAction("clear")}
          />

          <div className="my-1 border-t border-neutral-200 dark:border-neutral-800" />

          <ActionButton label={unit.note ? "Edit note" : "Add note"} onClick={onEditNote} />
          <ActionButton label="Open unit" onClick={onOpenUnit} />
        </div>

        <button
          type="button"
          onClick={onClose}
          className="mt-3 min-h-11 w-full rounded-lg bg-neutral-100 text-sm font-medium dark:bg-neutral-800"
        >
          Close
        </button>
      </div>
    </div>
  );
}

function ActionButton({
  label,
  active,
  onClick,
}: {
  label: string;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex min-h-12 items-center justify-between rounded-lg px-4 text-left text-sm font-medium ${
        active
          ? "bg-blue-600 text-white"
          : "bg-neutral-100 text-neutral-800 dark:bg-neutral-800 dark:text-neutral-200"
      }`}
    >
      {label}
      {active && <span>✓</span>}
    </button>
  );
}
