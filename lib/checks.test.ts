import { describe, expect, it } from "vitest";

import seed from "../fixtures/seed-projects.json";
import { checkFloor, checkFloorTagSpread, checkUnitWindows } from "./checks";
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

describe("floor-level motorized vs chain", () => {
  const win = (patch: Partial<WindowRecord>): WindowRecord =>
    ({
      id: "w9", updated_at: "", deleted: false, unit_id: "u1",
      tag_base: "LR", tag_index: 0, widths: [1000], height: 900, quantity: 1,
      control_override: null, deduct: null, longer_chain: false, note: "",
      sort_order: 0, ...patch,
    }) as WindowRecord;

  it("flags a chain on a window inheriting a motorized floor", () => {
    // The documented common case: the whole floor is motorized, the window
    // carries no override. Missed when the check only read the override.
    const w = checkUnitWindows({ number: "301" }, [win({ chain_length: 72 })], {
      motorized: true,
    });
    expect(w).toHaveLength(1);
    expect(w[0].message).toContain("pick one");
  });

  it("stays quiet when the window opts out of the motorized floor", () => {
    expect(
      checkUnitWindows({ number: "301" }, [win({ chain_length: 72, motorized_override: false })], {
        motorized: true,
      })
    ).toHaveLength(0);
  });

  it("keeps the old behaviour when no defaults are passed", () => {
    expect(checkUnitWindows({ number: "301" }, [win({ chain_length: 72 })])).toHaveLength(0);
  });
});


describe("checkFloorTagSpread", () => {
  /** A unit of `tags`, one blind each, on an otherwise ordinary floor. */
  const unitOf = (number: string, tags: string[], over: Partial<WindowRecord> = {}) => ({
    unit: { number },
    windows: tags.map(
      (t, i): WindowRecord => ({
        id: `${number}-${i}`,
        updated_at: "2026-09-18T00:00:00Z",
        deleted: false,
        unit_id: number,
        tag_base: t,
        tag_index: i + 1,
        widths: [800],
        height: 1392,
        quantity: 1,
        control_override: null,
        deduct: null,
        longer_chain: false,
        note: "",
        sort_order: i,
        ...over,
      }),
    ),
  });
  // Two neighbours that establish this as a multi-room floor.
  const neighbours = [unitOf("302", ["LR", "BR"]), unitOf("303", ["LR", "BR", "K"])];

  it("flags a unit whose blinds all carry one room tag", () => {
    const w = checkFloorTagSpread([unitOf("301", ["LR", "LR", "LR"]), ...neighbours]);
    expect(w).toHaveLength(1);
    expect(w[0].unit_number).toBe("301");
    expect(w[0].message).toContain("all 3 blinds here are tagged LR");
  });

  it("says nothing when the unit uses more than one room", () => {
    expect(checkFloorTagSpread([unitOf("301", ["LR", "LR", "BR"]), ...neighbours])).toEqual([]);
  });

  it("leaves two-blind units alone — a one-room unit that small is ordinary", () => {
    expect(checkFloorTagSpread([unitOf("301", ["LR", "LR"]), ...neighbours])).toEqual([]);
  });

  it("never fires on an untagged zone-run floor", () => {
    const zone = ["", "", "", "", ""];
    expect(
      checkFloorTagSpread([unitOf("A", zone), unitOf("B", zone), unitOf("C", zone)]),
    ).toEqual([]);
  });

  it("needs the floor itself to be multi-room before judging one unit", () => {
    // One neighbour is not a pattern: a small job of single-room units is not
    // evidence that this unit is wrong.
    expect(
      checkFloorTagSpread([unitOf("301", ["LR", "LR", "LR"]), unitOf("302", ["LR", "BR"])]),
    ).toEqual([]);
  });

  it("is dismissed by the same 'Looks right' that clears a measurement warning", () => {
    const w = checkFloorTagSpread([
      unitOf("301", ["LR", "LR", "LR"], { checks_ack: true }),
      ...neighbours,
    ]);
    expect(w).toEqual([]);
  });

  it("rides along on checkFloor, so the export review sheet shows it", () => {
    const w = checkFloor([unitOf("301", ["LR", "LR", "LR"]), ...neighbours]);
    expect(w.filter((x) => /tagged LR/.test(x.message))).toHaveLength(1);
  });

  it("stays quiet across the delivered jobs it was tuned against", () => {
    // The whole point is that it fires rarely enough to be believed. Arbour
    // and 44 Charles as delivered trip it zero times; a regression that makes
    // it chatty shows up here first.
    for (const project of [arbour, charles]) {
      for (const floor of project.floors) {
        expect(checkFloorTagSpread(floorInput(floor))).toEqual([]);
      }
    }
  });
});
