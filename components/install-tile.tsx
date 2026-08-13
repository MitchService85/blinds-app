"use client";

import type { Unit } from "@/lib/types";
import { blockedOf, deriveInstallState, INSTALL_STATE_TILE_CLASSES, installOf } from "./status";

interface InstallTileProps {
  unit: Unit;
  /** Tap anywhere on the tile opens the action sheet (see floor page) — no
   * long-press, no direct navigation; unlike Measure mode's UnitTile, this
   * is a plain button, not a Link. */
  onTap: () => void;
}

/** Install-mode floor-grid tile — see spec: Install mode. Deliberately a
 * separate component from UnitTile (Measure mode) rather than a shared
 * component with a mode switch, so Measure mode stays exactly untouched. */
export function InstallTile({ unit, onTap }: InstallTileProps) {
  const state = deriveInstallState(unit);
  const install = installOf(unit);
  const blocked = blockedOf(unit);

  let subline = "—";
  if (state === "na") subline = "N/A";
  else if (blocked) subline = "⚠️ blocked";
  else if (install === "done") subline = "✓ done";
  else if (install === "staged") subline = "🟢 staged";

  return (
    <button
      type="button"
      onClick={onTap}
      className={`flex min-h-16 w-full flex-col items-center justify-center gap-0.5 overflow-hidden rounded-lg border px-2 py-2 text-center ${INSTALL_STATE_TILE_CLASSES[state]}`}
    >
      <span className="w-full truncate text-sm font-semibold" title={unit.number}>
        {unit.number}
      </span>
      <span className="text-[11px] opacity-90">{subline}</span>
    </button>
  );
}
