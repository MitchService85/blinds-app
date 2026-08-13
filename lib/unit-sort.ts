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
