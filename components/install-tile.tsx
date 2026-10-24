"use client";

import type { Unit } from "@/lib/types";
import { Icon } from "@/components/icon";
import {
  deriveInstallState,
  INSTALL_STATE_TILE_CLASSES,
  installOf,
  installTileReason,
  lockedOf,
} from "./status";

interface InstallTileProps {
  unit: Unit;
  /**
   * Blinds ordered for this unit (panels x quantity). Shown on the tile so
   * the installer can count brackets and hardware off the grid before
   * starting a unit, without opening it (field request).
   */
  blindCount: number;
  /** Open deficiencies in this unit (crew and PM) — block it once installed. */
  openCount?: number;
  /** How many of those a PM raised: a tile with only PM ones reads "⚠ PM". */
  pmCount?: number;
  /** Tap anywhere on the tile opens the action sheet (see floor page) — no
   * long-press, no direct navigation; unlike Measure mode's UnitTile, this
   * is a plain button, not a Link. */
  onTap: () => void;
}

/** Install-mode floor-grid tile — see spec: Install mode. Deliberately a
 * separate component from UnitTile (Measure mode) rather than a shared
 * component with a mode switch, so Measure mode stays exactly untouched. */
export function InstallTile({ unit, blindCount, openCount = 0, pmCount = 0, onTap }: InstallTileProps) {
  const state = deriveInstallState(unit, openCount > 0);
  const install = installOf(unit);
  const reason = installTileReason(unit, { open: openCount, pm: pmCount });

  let subline: React.ReactNode = "—";
  if (state === "na") subline = "N/A";
  else if (lockedOf(unit))
    subline = (
      <>
        <Icon name="lock" size={12} /> locked out
      </>
    );
  else if (reason && reason.kind !== "to_check")
    // The tile says why it is yellow, so the crew can see from the grid
    // which units are theirs to fix, which wait on a PM, and which are on
    // hold for another trade — without opening each one.
    subline = (
      <span className="font-semibold">
        <Icon name="alert" size={12} /> {reason.text}
      </span>
    );
  else if (install === "done")
    subline = (
      <>
        <Icon name="check" size={12} /> installed
      </>
    );
  else if (install === "staged")
    subline = (
      <>
        <Icon name="circle-dot" size={12} /> staged
      </>
    );
  else if (reason?.kind === "to_check")
    subline = (
      <span className="text-amber-700 dark:text-amber-400">
        <Icon name="alert" size={12} /> {reason.text}
      </span>
    );

  return (
    <button
      type="button"
      onClick={onTap}
      className={`flex min-h-16 w-full flex-col items-center justify-center gap-0.5 overflow-hidden rounded-lg border px-2 py-2 text-center ${INSTALL_STATE_TILE_CLASSES[state]}`}
    >
      <span className="w-full truncate text-sm font-semibold" title={unit.number}>
        {unit.number}
      </span>
      <span className="inline-flex items-center gap-1 text-[11px] opacity-90 [&>span]:inline-flex [&>span]:items-center [&>span]:gap-1">
        {subline}
      </span>
      {/* Hardware count, dimmer than the status line so the install state
          still reads first. Skipped on N/A units and on units with nothing
          measured yet — there is no bracket count to carry up there. */}
      {state !== "na" && blindCount > 0 && (
        <span className="text-[11px] opacity-70">
          {blindCount} blind{blindCount === 1 ? "" : "s"}
        </span>
      )}
    </button>
  );
}
