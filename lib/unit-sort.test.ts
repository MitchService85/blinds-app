import { describe, expect, it } from "vitest";

import type { Unit } from "./types";
import { sortUnitsForDisplay, suggestUnitNumber } from "./unit-sort";

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

describe("suggestUnitNumber", () => {
  const u = (number: string, sort_order: number) => ({ number, sort_order });

  it("offers the floor's own label on an empty commercial floor", () => {
    // 1 Adelaide: a floor per level, one order each, so the only unit on the
    // floor is the floor. This is the retyping the fix removes.
    expect(suggestUnitNumber([], "Level 4", "commercial")).toBe("Level 4");
  });

  it("trims the label", () => {
    expect(suggestUnitNumber([], "  Level 15 ", "commercial")).toBe("Level 15");
  });

  it("stays blank on an empty residential floor", () => {
    // A suite is 401, not "Level 4" — a suggestion here would only be wrong.
    expect(suggestUnitNumber([], "Level 4", "residential")).toBe("");
  });

  it("increments a numeric unit number regardless of building type", () => {
    expect(suggestUnitNumber([u("401", 0), u("402", 1)], "Level 4", "residential")).toBe("403");
    expect(suggestUnitNumber([u("12", 0)], "Anything", "commercial")).toBe("13");
  });

  it("increments from the last-added unit, not the highest", () => {
    // Buildings are not measured in order (44 Charles batch 4 field note).
    expect(suggestUnitNumber([u("430", 1), u("407", 0)], "L4", "residential")).toBe("431");
  });

  it("never increments a free-text zone label", () => {
    expect(suggestUnitNumber([u("Level 1 - FE", 0)], "All Areas", "commercial")).toBe("");
    expect(suggestUnitNumber([u("L1- Snake Corridor", 0)], "All Areas", "commercial")).toBe("");
  });

  it("does not re-offer the floor label once a zone exists", () => {
    // Alcon's second zone must not be suggested as "All Areas".
    expect(suggestUnitNumber([u("Level 1 - FE", 0)], "All Areas", "commercial")).toBe("");
  });
});
