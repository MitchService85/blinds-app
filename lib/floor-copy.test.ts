import { describe, expect, it } from "vitest";
import { carryUnitNumber, compareFloorLabels, nextFloorLabel } from "./floor-copy";

describe("nextFloorLabel", () => {
  it("bumps the trailing number", () => {
    expect(nextFloorLabel("Level 4")).toBe("Level 5");
    expect(nextFloorLabel("Batch 2")).toBe("Batch 3");
    expect(nextFloorLabel("L9 West")).toBe("L10 West");
  });
  it("falls back when there is no number", () => {
    expect(nextFloorLabel("Penthouse")).toBe("Penthouse copy");
  });
});

describe("carryUnitNumber", () => {
  it("renames zone-run units that carry the floor label", () => {
    expect(carryUnitNumber("Level 4", "Level 4", "Level 7")).toBe("Level 7");
    expect(carryUnitNumber("Level 4 - East", "Level 4", "Level 7")).toBe("Level 7 - East");
  });
  it("leaves residential numbers alone", () => {
    expect(carryUnitNumber("401", "Level 4", "Level 7")).toBe("401");
  });
});

describe("compareFloorLabels", () => {
  it("orders by the number inside the label, then alphabetically", () => {
    const sorted = ["Level 10", "Penthouse", "Level 2", "Batch 1", "All Levels"].sort(compareFloorLabels);
    expect(sorted).toEqual(["Batch 1", "Level 2", "Level 10", "All Levels", "Penthouse"]);
  });
});
