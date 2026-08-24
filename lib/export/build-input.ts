// Builds the ExportInput for a floor from live rows.
//
// Shared deliberately: the export button and the floor screen's "changes
// since last export" line must derive the snapshot the same way, or the diff
// would report phantom changes against a file that was built differently.
import { sortUnitsForDisplay } from "../unit-sort";
import type { Floor, Unit, WindowRecord } from "../types";
import { windowBlindCount, type ExportInput } from "./shared";

export interface BuildInputArgs {
  projectName: string;
  floor: Floor;
  units: Unit[];
  windowsByUnit: Map<string, WindowRecord[]>;
  /** ISO date (yyyy-mm-dd). Defaults to today in the device's timezone. */
  exportDate?: string;
}

/**
 * Today as yyyy-mm-dd in the device's own timezone. toISOString() is UTC and
 * flips to tomorrow at 8pm Toronto — the wrong date on an evening export.
 * The Swedish locale happens to format dates as ISO.
 */
export function localDateISO(now = new Date()): string {
  return now.toLocaleDateString("sv-SE");
}

export function buildExportInput({
  projectName,
  floor,
  units,
  windowsByUnit,
  exportDate,
}: BuildInputArgs): ExportInput {
  return {
    project_name: projectName,
    floor_label: floor.label,
    export_date: exportDate ?? localDateISO(),
    defaults: floor.defaults,
    units: sortUnitsForDisplay(units).map((u) => ({
      id: u.id,
      number: u.number,
      status: u.status,
      windows: (windowsByUnit.get(u.id) ?? [])
        .slice()
        .sort((a, b) => a.sort_order - b.sort_order)
        .map((w) => ({
          id: w.id,
          tag_base: w.tag_base,
          tag_index: w.tag_index,
          widths: w.widths,
          height: w.height,
          quantity: w.quantity ?? 1,
          control_override: w.control_override,
          // Slice defends against rows written before the removePanel fix,
          // whose stored array can be longer than widths.
          panel_controls: w.panel_controls?.slice(0, w.widths.length) ?? null,
          mount_override: w.mount_override ?? null,
          tight_override: w.tight_override ?? null,
          deduct: w.deduct,
          chain_length: w.chain_length ?? null,
          longer_chain: w.longer_chain,
          motorized_override: w.motorized_override ?? null,
          note: w.note,
        })),
    })),
  };
}

/** Blinds represented by a snapshot: one per panel, times the quantity. */
export function countBlinds(input: ExportInput): number {
  let total = 0;
  for (const unit of input.units) {
    if (unit.status === "na") continue;
    for (const w of unit.windows) total += windowBlindCount(w);
  }
  return total;
}
