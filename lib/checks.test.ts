import { describe, expect, it } from "vitest";

import seed from "../fixtures/seed-projects.json";
import { checkFloor } from "./checks";
import type { WindowRecord } from "./types";

type SeedWindow = {
  tag_base: string;
  tag_index: number;
  widths: number[];
  height: number;
};
type SeedFloor = {
  label: string;
  units: { number: string; windows: SeedWindow[] }[];
};

function floorInput(floor: SeedFloor) {
  return floor.units.map((u, ui) => ({
    unit: { number: u.number },
    windows: u.windows.map(
      (w, wi): WindowRecord => ({
        id: `w-${ui}-${wi}`,
        updated_at: "2026-08-12T00:00:00Z",
        deleted: false,
        unit_id: `u-${ui}`,
        tag_base: w.tag_base,
        tag_index: w.tag_index,
        widths: w.widths,
        height: w.height,
        control_override: null,
        deduct: null,
        longer_chain: false,
        note: "",
        sort_order: wi,
      }),
    ),
  }));
}

const projects = (seed as { projects: { name: string; floors: SeedFloor[] }[] })
  .projects;
const byName = (n: string) => {
  const p = projects.find((p) => p.name.includes(n));
  if (!p) throw new Error(`seed project ${n} missing`);
  return p;
};
const arbour = byName("Arbour");
const charles = byName("44 Charles");

describe("checkFloor against real project data", () => {
  it("flags exactly the two asymmetric bays in 44 Charles Batch 3", () => {
    const warnings = checkFloor(floorInput(charles.floors[0]));
    const flagged = warnings.map((w) => `${w.unit_number}-${w.tag}`).sort();
    expect(flagged).toEqual(["1216-BR", "1615-LR"]);
  });

  it("reports both side widths in the message", () => {
    const warnings = checkFloor(floorInput(charles.floors[0]));
    const w1216 = warnings.find((w) => w.unit_number === "1216");
    expect(w1216?.message).toContain("29");
    expect(w1216?.message).toContain("34 7/8");
  });

  it("does not flag anything on Arbour Level 2 or Level 4 (single-panel windows)", () => {
    for (const floor of arbour.floors) {
      expect(checkFloor(floorInput(floor))).toEqual([]);
    }
  });

  it("ignores soft-deleted windows", () => {
    const input = floorInput(charles.floors[0]);
    for (const u of input) for (const w of u.windows) w.deleted = true;
    expect(checkFloor(input)).toEqual([]);
  });
});
