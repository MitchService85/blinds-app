import type { WindowRecord } from "./types";

/**
 * Compute display/export tag labels for a unit's windows, e.g. "LR", "LR1",
 * "LR2", "BR". Pass all (non-deleted) windows belonging to a single unit —
 * this groups them by tag_base internally, since a unit typically mixes
 * several room tags (LR, BR, Kit...).
 *
 * Rule (per spec): a lone window of a given tag_base exports as the plain
 * tag ("LR") — its tag_index is irrelevant. As soon as a second window of
 * the same tag_base exists, every window in that group is numbered 1..n by
 * sort_order ("LR1", "LR2"), including retroactively renumbering a
 * previously-lone window.
 *
 * Note: this returns the bare room-tag label only (no unit-number prefix).
 * The exporter is responsible for building the full "{unit}-{tag}" string
 * (e.g. "401-LR1").
 */
export function computeTagLabels(
  windows: Pick<WindowRecord, "id" | "tag_base" | "sort_order" | "deleted">[]
): Map<string, string> {
  const labels = new Map<string, string>();

  const groups = new Map<string, typeof windows>();
  for (const w of windows) {
    if (w.deleted) continue;
    const group = groups.get(w.tag_base);
    if (group) {
      group.push(w);
    } else {
      groups.set(w.tag_base, [w]);
    }
  }

  for (const [tagBase, group] of groups) {
    if (group.length === 1) {
      labels.set(group[0].id, tagBase);
      continue;
    }
    const sorted = [...group].sort((a, b) => a.sort_order - b.sort_order);
    sorted.forEach((w, i) => {
      labels.set(w.id, `${tagBase}${i + 1}`);
    });
  }

  return labels;
}


/**
 * The distinct rooms a unit's blinds cover, in the order they were measured.
 *
 * Shown on the floor-grid tile so a floor reads as a column of room lists —
 * `LR BR K` beside `LR BR K` beside a lone `LR`. A room tag is never wrong in
 * isolation; it is wrong because the unit next door has a BR and this one
 * does not, and that comparison is one a person makes instantly across a grid
 * and slowly one unit at a time (field note, 2026-09-18: a bedroom measured
 * and left tagged LR, twice).
 *
 * Measured order, not alphabetical: it is walking order, so a unit whose list
 * starts somewhere odd is itself worth a look. Untagged windows are the
 * office/zone-run format rather than a room and are left out — those floors
 * show nothing here, which is correct.
 */
export function unitRooms(
  windows: Pick<WindowRecord, "tag_base" | "sort_order" | "deleted">[]
): string[] {
  const rooms: string[] = [];
  const seen = new Set<string>();
  for (const w of [...windows].sort((a, b) => a.sort_order - b.sort_order)) {
    if (w.deleted || w.tag_base === "" || seen.has(w.tag_base)) continue;
    seen.add(w.tag_base);
    rooms.push(w.tag_base);
  }
  return rooms;
}
