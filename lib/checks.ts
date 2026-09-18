// Measurement sanity checks, shown as non-blocking warnings on unit-done and
// export. Tuned against the real Arbour House L2/L4 and 44 Charles Batch 3
// data: the only rule that isolates known entry errors without false-flagging
// legitimate variation is within-window bay symmetry. Cross-unit size
// comparisons false-positive heavily (room sizes genuinely vary) — do not add
// one without re-running fixtures/generate_seed.py data through it.

import { effectiveMotorized } from "./export/shared";
import { formatFraction } from "./fractions";
import type { FloorDefaults, Unit, WindowRecord } from "./types";

/** Bay side panels normally match within ~3/4"; flag beyond 1.5". */
const BAY_SIDE_DIFF_MAX = 24; // sixteenths

// Plausibility bounds, set from every real measurement across the three
// delivered jobs (widths 16 3/8"-113 1/2", heights 57 1/2"-98 1/2") with room
// to spare. These catch mistyped entries — a dropped leading digit turns
// 74 7/8 into 4 7/8, and a digit appended to a prefilled height turns 87 into
// 876 — rather than anything about how the blind is built.
// Chain lengths seen or asked for in the corpus run 48" to 160"; the
// Instructions sheet's own examples are 72, 48, 60. Outside this band is a
// typo, not a job requirement.
const MIN_PLAUSIBLE_CHAIN = 12;
const MAX_PLAUSIBLE_CHAIN = 240;

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
  /**
   * Floor defaults, when the caller has them. Motorized is a floor setting
   * with a per-window override, so the motorized-vs-chain contradiction must
   * resolve through the floor — checking only the override misses the
   * documented common case of a whole floor marked motorized.
   */
  defaults?: Pick<FloorDefaults, "motorized">,
): MeasurementWarning[] {
  const warnings: MeasurementWarning[] = [];
  for (const w of windows) {
    if (w.deleted) continue;
    // Dismissed by hand after a look on site. Side panels genuinely differ on
    // plenty of real bays, so the tech gets to close the loop.
    if (w.checks_ack) continue;

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

    // A motorized shade has no chain. Ordering both is contradictory and the
    // factory has to guess which one the site actually needs.
    const motorized = defaults
      ? effectiveMotorized(defaults, w.motorized_override)
      : w.motorized_override === true;
    const chain = typeof w.chain_length === "number" ? w.chain_length : null;
    if (motorized && chain !== null && chain > 0) {
      warnings.push({
        window_id: w.id,
        unit_number: unit.number,
        tag: tagLabel(w),
        message: `motorized but also has a ${chain}" chain — pick one`,
      });
    }
    if (chain !== null && chain > 0 && (chain < MIN_PLAUSIBLE_CHAIN || chain > MAX_PLAUSIBLE_CHAIN)) {
      warnings.push({
        window_id: w.id,
        unit_number: unit.number,
        tag: tagLabel(w),
        message: `chain length ${chain}" looks off — check the digits`,
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

/**
 * A unit whose blinds ALL carry one room tag, on a floor where the other
 * units use several.
 *
 * The entry form carries the last saved tag forward, which is what makes a
 * zone run fast — and what silently tags a bedroom "LR" when you walk into
 * the next room and start measuring (field note, 2026-09-18: twice). This is
 * the backstop: it cannot know which blind is wrong, but it knows a unit
 * whose every blind claims the same room on a floor of multi-room units is
 * worth a second look before it reaches the factory.
 *
 * Deliberately a FLOOR-level rule. The floor is what says whether single-tag
 * units are the exception or the format: an office/zone-run floor enters
 * everything untagged, and a genuine one-room unit on a mixed floor is rare
 * enough to be worth confirming. Run over every unit of all three delivered
 * jobs plus Daniel's it fires three times in ~200 units — see
 * checks.test.ts, which pins that count.
 */
const MIN_BLINDS_FOR_TAG_SPREAD = 3;
/** Other units that must show 2+ tags before this floor counts as multi-room. */
const MIN_MULTI_TAG_UNITS = 2;

export function checkFloorTagSpread(
  units: { unit: Pick<Unit, "number">; windows: WindowRecord[] }[],
): MeasurementWarning[] {
  // Untagged windows are the office/zone-run format, not a room — a floor of
  // them has nothing to compare and never trips this.
  const tagged = units.map(({ unit, windows }) => ({
    unit,
    windows: windows.filter((w) => !w.deleted && w.tag_base !== ""),
  }));
  const distinctTags = (ws: WindowRecord[]) => new Set(ws.map((w) => w.tag_base));
  const multiTagUnits = tagged.filter((u) => distinctTags(u.windows).size >= 2).length;
  if (multiTagUnits < MIN_MULTI_TAG_UNITS) return [];

  const warnings: MeasurementWarning[] = [];
  for (const { unit, windows } of tagged) {
    if (windows.length < MIN_BLINDS_FOR_TAG_SPREAD) continue;
    const tags = distinctTags(windows);
    if (tags.size !== 1) continue;
    // Anchored to the unit's first blind so the existing per-window "Looks
    // right" is what dismisses it — a corner unit really can be all LR.
    const anchor = windows[0];
    if (anchor.checks_ack) continue;
    warnings.push({
      window_id: anchor.id,
      unit_number: unit.number,
      tag: tagLabel(anchor),
      message:
        `all ${windows.length} blinds here are tagged ${anchor.tag_base}` +
        ` — check the room tags, the last one carries over`,
    });
  }
  return warnings;
}

/** Convenience for export: run every unit on a floor. */
export function checkFloor(
  units: { unit: Pick<Unit, "number">; windows: WindowRecord[] }[],
  defaults?: Pick<FloorDefaults, "motorized">,
): MeasurementWarning[] {
  return [
    ...units.flatMap(({ unit, windows }) => checkUnitWindows(unit, windows, defaults)),
    ...checkFloorTagSpread(units),
  ];
}
