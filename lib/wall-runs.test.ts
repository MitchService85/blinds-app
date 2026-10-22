import { describe, expect, it } from "vitest";
import { findWallRuns, type RunWindow } from "./wall-runs";
import type { Deduct } from "./types";

let n = 0;
const w = (tag_base: string, width: number, deduct: Deduct, widths = [width]): RunWindow => ({
  id: `${tag_base}-${n}`, tag_base, sort_order: n++, deduct, widths,
});

describe("findWallRuns", () => {
  it("finds Arbour L8's three-window bays and adds them up", () => {
    // 804: BR1 | BR2 | LR1 Dl 21 3/4 | LR2 69 1/8 | LR3 Dr 33 | MBR
    const unit = [w("BR", 1897, "D"), w("BR", 1078, "D"), w("LR", 348, "Dl"), w("LR", 1106, null), w("LR", 528, "Dr"), w("MBR", 1289, null)];
    const runs = findWallRuns(unit);
    expect(runs).toHaveLength(1);
    expect(runs[0].ids).toEqual([unit[2].id, unit[3].id, unit[4].id]);
    expect(runs[0].total).toBe(348 + 1106 + 528);
  });

  it("takes a two-window bay too (815 MBR1 Dl | MBR2 Dr)", () => {
    const unit = [w("MBR", 1822, "Dl"), w("MBR", 1248, "Dr")];
    expect(findWallRuns(unit).map((r) => r.total)).toEqual([1822 + 1248]);
  });

  it("leaves separate windows alone", () => {
    // 806: LR1 D | LR2 | LR3 — three windows, no Dl/Dr pair.
    expect(findWallRuns([w("LR", 1127, "D"), w("LR", 982, null), w("LR", 1120, null)])).toEqual([]);
    // A Dl that never reaches a Dr, a tag change, a deduct in the middle.
    expect(findWallRuns([w("LR", 500, "Dl"), w("LR", 500, null)])).toEqual([]);
    expect(findWallRuns([w("LR", 500, "Dl"), w("BR", 500, "Dr")])).toEqual([]);
    expect(findWallRuns([w("LR", 500, "Dl"), w("LR", 500, "D"), w("LR", 500, "Dr")])).toEqual([]);
  });

  it("never pulls a multi-panel bay into a run", () => {
    expect(findWallRuns([w("LR", 500, "Dl"), w("LR", 0, null, [500, 500]), w("LR", 500, "Dr")])).toEqual([]);
  });
});
