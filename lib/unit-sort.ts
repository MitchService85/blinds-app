import type { Unit } from "./types";

/**
 * Display/export ordering for a floor's units.
 *
 * Residential floors are measured in whatever order the crew walks (502
 * before 501), but the grid and the factory spreadsheet should read in unit
 * order — so when EVERY unit number on the floor is purely numeric, sort
 * numerically.
 *
 * Office/commercial zone labels ("Level 1 - FE", "L1- Snake Corridor") keep
 * their entry order: that's the walking order of the building and
 * alphabetizing it would scramble something intentional.
 */
export function sortUnitsForDisplay(units: Unit[]): Unit[] {
  const sorted = [...units];
  const allNumeric = units.length > 0 && units.every((u) => /^\d+$/.test(u.number.trim()));
  if (allNumeric) {
    sorted.sort(
      (a, b) =>
        parseInt(a.number, 10) - parseInt(b.number, 10) || a.sort_order - b.sort_order,
    );
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
