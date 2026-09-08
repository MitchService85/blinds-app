// Duplicate-floor helpers, pure so they can be tested without IndexedDB.

/** "Level 4" -> "Level 5"; "Batch 2" -> "Batch 3"; no number -> "<label> copy". */
export function nextFloorLabel(label: string): string {
  const m = /^(.*?)(\d+)(\D*)$/.exec(label.trim());
  if (!m) return `${label.trim()} copy`;
  return `${m[1]}${parseInt(m[2], 10) + 1}${m[3]}`;
}

/**
 * Carry a unit number across floors. Zone-run floors name their one unit
 * after the floor ("Level 4", "Level 4 - East"), so the floor label inside
 * the number follows the new label; residential numbers ("401") are left
 * alone for the crew to renumber, since 4xx -> 7xx is a guess the app
 * should not make.
 */
export function carryUnitNumber(number: string, fromLabel: string, toLabel: string): string {
  const from = fromLabel.trim();
  if (!from) return number;
  return number.split(from).join(toLabel.trim());
}

/** "Level 2" before "Level 10"; labels without a number sort after, alphabetically. */
export function compareFloorLabels(a: string, b: string): number {
  const na = /\d+/.exec(a)?.[0];
  const nb = /\d+/.exec(b)?.[0];
  if (na && nb && parseInt(na, 10) !== parseInt(nb, 10)) return parseInt(na, 10) - parseInt(nb, 10);
  if (na && !nb) return -1;
  if (!na && nb) return 1;
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}
