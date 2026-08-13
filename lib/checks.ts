// Measurement sanity checks, shown as non-blocking warnings on unit-done and
// export. Tuned against the real Arbour House L2/L4 and 44 Charles Batch 3
// data: the only rule that isolates known entry errors without false-flagging
// legitimate variation is within-window bay symmetry. Cross-unit size
// comparisons false-positive heavily (room sizes genuinely vary) — do not add
// one without re-running fixtures/generate_seed.py data through it.

import { formatFraction } from "./fractions";
import type { Unit, WindowRecord } from "./types";

/** Bay side panels normally match within ~3/4"; flag beyond 1.5". */
const BAY_SIDE_DIFF_MAX = 24; // sixteenths

export interface MeasurementWarning {
  window_id: string;
  unit_number: string;
  /** Room tag as displayed, e.g. "BR", "LR2" */
  tag: string;
  message: string;
}

function tagLabel(w: WindowRecord): string {
  return w.tag_index > 0 ? `${w.tag_base}${w.tag_index}` : w.tag_base;
}

export function checkUnitWindows(
  unit: Pick<Unit, "number">,
  windows: WindowRecord[],
): MeasurementWarning[] {
  const warnings: MeasurementWarning[] = [];
  for (const w of windows) {
    if (w.deleted || w.widths.length < 3) continue;
    const first = w.widths[0];
    const last = w.widths[w.widths.length - 1];
    if (Math.abs(first - last) > BAY_SIDE_DIFF_MAX) {
      warnings.push({
        window_id: w.id,
        unit_number: unit.number,
        tag: tagLabel(w),
        message:
          `side panels differ: ${formatFraction(first)} vs ${formatFraction(last)}` +
          ` — bay sides are usually near-equal, double-check this one`,
      });
    }
  }
  return warnings;
}

/** Convenience for export: run every unit on a floor. */
export function checkFloor(
  units: { unit: Pick<Unit, "number">; windows: WindowRecord[] }[],
): MeasurementWarning[] {
  return units.flatMap(({ unit, windows }) => checkUnitWindows(unit, windows));
}
