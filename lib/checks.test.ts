import { describe, expect, it } from "vitest";

import seed from "../fixtures/seed-projects.json";
import { checkFloor, checkUnitWindows } from "./checks";
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
        quantity: 1,
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

describe("plausibility warnings", () => {
  function win(widths: number[], height: number): WindowRecord {
    return {
      id: "w1",
      updated_at: "",
      deleted: false,
      unit_id: "u1",
      tag_base: "LR",
      tag_index: 0,
      widths,
      height,
      quantity: 1,
      control_override: null,
      deduct: null,
      longer_chain: false,
      note: "",
      sort_order: 0,
    };
  }
  const unit = { number: "401" };

  it("flags a width that lost its leading digit (74 7/8 -> 4 7/8)", () => {
    const warnings = checkUnitWindows(unit, [win([78], 1392)]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toContain("missed digit");
  });

  it("flags a height with an extra digit appended (87 -> 876)", () => {
    const warnings = checkUnitWindows(unit, [win([1198], 876 * 16)]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toContain("extra digit");
  });

  it("passes every real measurement in all three seeded jobs", () => {
    for (const project of projects) {
      for (const floor of project.floors) {
        expect(
          checkFloor(floorInput(floor)).filter((w) => /looks off/.test(w.message)),
        ).toEqual([]);
      }
    }
  });

  it("ignores incomplete rows (still being entered)", () => {
    expect(checkUnitWindows(unit, [win([0], 0)])).toEqual([]);
  });
});

describe("motorized and chain checks", () => {
  const win = (patch: Partial<WindowRecord>): WindowRecord =>
    ({
      id: "w1",
      updated_at: "",
      deleted: false,
      unit_id: "u1",
      tag_base: "LR",
      tag_index: 0,
      widths: [1000],
      height: 900,
      quantity: 1,
      control_override: null,
      deduct: null,
      longer_chain: false,
      note: "",
      sort_order: 0,
      ...patch,
    }) as WindowRecord;

  it("flags a motorized window that also carries a chain", () => {
    const w = checkUnitWindows({ number: "301" }, [
      win({ motorized_override: true, chain_length: 72 }),
    ]);
    expect(w).toHaveLength(1);
    expect(w[0].message).toContain("pick one");
  });

  it("accepts motorized with no chain", () => {
    expect(
      checkUnitWindows({ number: "301" }, [win({ motorized_override: true })])
    ).toHaveLength(0);
  });

  it("accepts a chain on a non-motorized window", () => {
    expect(
      checkUnitWindows({ number: "301" }, [win({ chain_length: 72 })])
    ).toHaveLength(0);
  });

  it("flags an implausible chain length", () => {
    const w = checkUnitWindows({ number: "301" }, [win({ chain_length: 7200 })]);
    expect(w[0].message).toContain("looks off");
  });
});

describe("checks_ack", () => {
  const bay = (patch: Partial<WindowRecord>): WindowRecord =>
    ({
      id: "w1", updated_at: "", deleted: false, unit_id: "u1",
      tag_base: "LR", tag_index: 0,
      widths: [400, 800, 900], // sides differ by 31 1/4", well past the 1.5" flag
      height: 900, quantity: 1, control_override: null, deduct: null,
      longer_chain: false, note: "", sort_order: 0, ...patch,
    }) as WindowRecord;

  it("flags mismatched bay sides by default", () => {
    expect(checkUnitWindows({ number: "601" }, [bay({})])).toHaveLength(1);
  });

  it("goes quiet once the tech marks it checked", () => {
    expect(checkUnitWindows({ number: "601" }, [bay({ checks_ack: true })])).toHaveLength(0);
  });

  it("silences every check on that window, not just the bay one", () => {
    const wild = bay({ checks_ack: true, height: 99 * 16 }); // also implausible
    expect(checkUnitWindows({ number: "601" }, [wild])).toHaveLength(0);
  });

  it("does not silence other windows", () => {
    const flagged = checkUnitWindows({ number: "601" }, [
      bay({ id: "a", checks_ack: true }),
      bay({ id: "b" }),
    ]);
    expect(flagged).toHaveLength(1);
    expect(flagged[0].window_id).toBe("b");
  });
});
