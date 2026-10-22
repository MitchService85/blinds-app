// Bays measured as separate windows: the same room tag, side by side, the
// left one deducted on the left (Dl), the right one on the right (Dr), the
// ones between untouched. That is how Arbour enters a 3-panel window —
// 801 is LR1 Dl | LR2 | LR3 Dr — rather than as one window with three
// panels, so the bay's total width has to be found across the windows.
import { totalWidth } from "./fractions";
import type { Deduct } from "./types";

export interface RunWindow {
  id: string;
  tag_base: string;
  sort_order: number;
  deduct: Deduct;
  widths: number[];
  deleted?: boolean;
}

export interface WallRun {
  /** The windows, left to right. */
  ids: string[];
  /** Their widths added up as ordered (see totalWidth). */
  total: number;
}

/**
 * Every Dl … Dr run of single-panel windows sharing a room tag, in measured
 * order. A window with several panels is a bay on its own and never part of
 * a run; anything that breaks the pattern (another tag, a deduct in the
 * middle, a run that never reaches a Dr) ends it without one.
 */
export function findWallRuns(windows: RunWindow[]): WallRun[] {
  const list = windows.filter((w) => !w.deleted).sort((a, b) => a.sort_order - b.sort_order);
  const runs: WallRun[] = [];
  let i = 0;
  while (i < list.length) {
    const start = list[i];
    if (start.deduct !== "Dl" || start.widths.length !== 1) {
      i++;
      continue;
    }
    let j = i + 1;
    let end = -1;
    while (j < list.length) {
      const w = list[j];
      if (w.tag_base !== start.tag_base || w.widths.length !== 1) break;
      if (w.deduct === "Dr") {
        end = j;
        break;
      }
      if (w.deduct !== null) break;
      j++;
    }
    if (end === -1) {
      i++;
      continue;
    }
    const members = list.slice(i, end + 1);
    runs.push({ ids: members.map((w) => w.id), total: totalWidth(members.flatMap((w) => w.widths)) });
    i = end + 1;
  }
  return runs;
}
