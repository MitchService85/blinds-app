import { describe, expect, it } from "vitest";

import type { Unit } from "./types";
import { sortUnitsForDisplay } from "./unit-sort";

function unit(number: string, sort_order: number): Unit {
  return {
    id: `u-${number}`,
    updated_at: "",
    deleted: false,
    floor_id: "f",
    number,
    status: "active",
    note: "",
    install: null,
    install_blocked: false,
    sort_order,
  };
}

describe("sortUnitsForDisplay", () => {
  it("sorts numeric units by number regardless of measure order (502 before 501)", () => {
    const units = [unit("502", 0), unit("501", 1), unit("510", 2), unit("509", 3)];
    expect(sortUnitsForDisplay(units).map((u) => u.number)).toEqual([
      "501",
      "502",
      "509",
      "510",
    ]);
  });

  it("keeps entry (walking) order when any unit is a zone label", () => {
    const units = [
      unit("Level 1 - FE", 0),
      unit("Level 1", 1),
      unit("L1- Snake Corridor", 2),
      unit("Level 2", 3),
    ];
    expect(sortUnitsForDisplay(units).map((u) => u.number)).toEqual([
      "Level 1 - FE",
      "Level 1",
      "L1- Snake Corridor",
      "Level 2",
    ]);
  });

  it("does not mutate the input array", () => {
    const units = [unit("2", 0), unit("1", 1)];
    sortUnitsForDisplay(units);
    expect(units.map((u) => u.number)).toEqual(["2", "1"]);
  });
});
