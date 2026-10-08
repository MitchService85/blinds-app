import { describe, expect, it } from "vitest";
import { floorSettingParts } from "./floor-summary";

const base = {
  roll: false,
  drive: "R" as const,
  tight: false,
  measure: undefined,
  mount: null,
  motorized: false,
  chain_type: "",
  d_value: "1/2",
  extra_note: "",
};

describe("floorSettingParts", () => {
  it("reads in words: Drive kept, D= spelled out as Deduct", () => {
    expect(floorSettingParts({ ...base, measure: "tight", mount: "inside" })).toEqual([
      "Drive R",
      "Tight",
      "Inside",
      "Deduct 1/2",
    ]);
  });

  it("names unset measure and mount only when asked", () => {
    expect(floorSettingParts(base)).toEqual(["Drive R", "Deduct 1/2"]);
    expect(floorSettingParts(base, { showUnset: true })).toEqual([
      "Drive R",
      "Measure not noted",
      "Mount not noted",
      "Deduct 1/2",
    ]);
  });

  it("keeps the floor chips' order and extras", () => {
    expect(
      floorSettingParts({
        ...base,
        roll: true,
        drive: "L",
        measure: "finished",
        mount: "outside",
        motorized: true,
        chain_type: "Metal",
        d_value: "1/4",
        extra_note: "DRILL HOLES",
      })
    ).toEqual(["Rev", "Drive L", "Finished", "Outside", "Motorized", "Metal chain", "Deduct 1/4", "DRILL HOLES"]);
  });

  it("reads the legacy tight flag as Tight", () => {
    expect(floorSettingParts({ ...base, tight: true })).toContain("Tight");
  });
});
