import type { Unit } from "./types";

const isNumeric = (u: Pick<Unit, "number">) => /^\d+$/.test(u.number.trim());

/**
 * Display/export ordering for a floor's units.
 *
 * Residential floors are measured in whatever order the crew walks (502
 * before 501), but the grid and the factory spreadsheet should read in unit
 * order — so a floor of numbered units sorts numerically.
 *
 * Office/commercial zone labels ("Level 1 - FE", "L1- Snake Corridor") keep
 * their entry order: that's the walking order of the building and
 * alphabetizing it would scramble something intentional.
 *
 * It used to take EVERY unit being numeric to sort numerically, which made
 * one odd label contagious: a placeholder unit typed "70?" on a floor of
 * 701-724 flipped all twenty-four back to walking order, and the floor
 * looked scrambled for no visible reason (Arbour Level 7, 2026-10-05).
 * A floor is numbered if MOST of it is, and the few that aren't go last in
 * the order they were added rather than dragging the rest with them.
 */
export function sortUnitsForDisplay(units: Unit[]): Unit[] {
  const sorted = [...units];
  const numericCount = units.filter(isNumeric).length;
  const mostlyNumbered = numericCount * 2 > units.length;
  if (mostlyNumbered) {
    sorted.sort((a, b) => {
      const an = isNumeric(a);
      const bn = isNumeric(b);
      // Anything that is not a plain number sits after the numbered units,
      // where it is obvious rather than lost in the middle of the grid.
      if (an !== bn) return an ? -1 : 1;
      if (!an) return a.sort_order - b.sort_order;
      return parseInt(a.number, 10) - parseInt(b.number, 10) || a.sort_order - b.sort_order;
    });
  } else {
    sorted.sort((a, b) => a.sort_order - b.sort_order);
  }
  return sorted;
}

/**
 * What to prefill the add-unit box with.
 *
 * Normally the next number up from the last-added unit, but only when that
 * number is purely numeric ("430" -> "431"). Commercial jobs use free-text
 * zone labels ("Level 1 - FE", "L1- Snake Corridor") which must never be
 * incremented from.
 *
 * The empty-floor case is the interesting one. On commercial jobs the floor
 * is frequently the zone itself: 1 Adelaide is a floor per level, each its own
 * order, so the only unit on the floor ends up named after the floor and the
 * tech types that name twice. Offer it instead. Floors that genuinely split
 * into zones (Alcon's "All Areas" holding "Level 1 - FE") cost one keystroke,
 * since the first keypress replaces a pristine suggestion.
 *
 * Residential stays blank: a suite number like 401 has nothing to do with a
 * floor labelled "Level 4", so any suggestion there would just be wrong.
 */
export function suggestUnitNumber(
  units: Pick<Unit, "number" | "sort_order">[],
  floorLabel: string,
  buildingType: "residential" | "commercial"
): string {
  if (units.length === 0) {
    return buildingType === "commercial" ? floorLabel.trim() : "";
  }
  const sorted = [...units].sort((a, b) => a.sort_order - b.sort_order);
  const last = sorted[sorted.length - 1].number.trim();
  if (!/^\d+$/.test(last)) return "";
  return String(parseInt(last, 10) + 1);
}
