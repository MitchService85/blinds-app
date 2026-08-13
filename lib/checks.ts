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

// Plausibility bounds, set from every real measurement across the three
// delivered jobs (widths 16 3/8"-113 1/2", heights 57 1/2"-98 1/2") with room
// to spare. These catch mistyped entries — a dropped leading digit turns
// 74 7/8 into 4 7/8, and a digit appended to a prefilled height turns 87 into
// 876 — rather than anything about how the blind is built.
const MIN_PLAUSIBLE_WIDTH = 12 * 16;
const MAX_PLAUSIBLE_WIDTH = 160 * 16;
const MIN_PLAUSIBLE_HEIGHT = 24 * 16;
const MAX_PLAUSIBLE_HEIGHT = 130 * 16;

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
    if (w.deleted) continue;

    for (const width of w.widths) {
      if (width > 0 && (width < MIN_PLAUSIBLE_WIDTH || width > MAX_PLAUSIBLE_WIDTH)) {
        warnings.push({
          window_id: w.id,
          unit_number: unit.number,
          tag: tagLabel(w),
          message: `width ${formatFraction(width)}" looks off — check for a missed digit`,
        });
      }
    }
    if (
      w.height > 0 &&
      (w.height < MIN_PLAUSIBLE_HEIGHT || w.height > MAX_PLAUSIBLE_HEIGHT)
    ) {
      warnings.push({
        window_id: w.id,
        unit_number: unit.number,
        tag: tagLabel(w),
        message: `height ${formatFraction(w.height)}" looks off — check for an extra digit`,
      });
    }

    if (w.widths.length < 3) continue;
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
