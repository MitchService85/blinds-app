import { describe, expect, it } from "vitest";
import { windowBadges } from "./window-badges";
import type { FloorDefaults, WindowRecord } from "./types";

type BadgeWindow = Parameters<typeof windowBadges>[0];

const floor = (over: Partial<FloorDefaults> = {}): FloorDefaults => ({
  roll: false,
  drive: "R",
  tight: true,
  measure: "tight",
  mount: "inside",
  extra_note: "",
  d_value: "0.5",
  color_codes: { mbed: "", liv: "", bed: "", kit: "", stu: "" },
  ...over,
});

const win = (over: Partial<WindowRecord> = {}): BadgeWindow => ({
  widths: [480],
  deduct: null,
  control_override: null,
  panel_controls: null,
  chain_length: null,
  longer_chain: false,
  note: "",
  ...over,
});

const keys = (w: BadgeWindow, d?: FloorDefaults) => windowBadges(w, d).map((b) => b.key);
const labelOf = (w: BadgeWindow, key: string, d?: FloorDefaults) =>
  windowBadges(w, d).find((b) => b.key === key)?.label;
const titleOf = (w: BadgeWindow, key: string, d?: FloorDefaults) =>
  windowBadges(w, d).find((b) => b.key === key)?.title;

describe("windowBadges", () => {
  it("shows nothing for a window that just inherits the floor", () => {
    expect(windowBadges(win(), floor())).toEqual([]);
  });

  it("badges a Finished override — the case that started this", () => {
    expect(labelOf(win({ measure_override: "finished" }), "measure", floor())).toBe("Fin");
    expect(titleOf(win({ measure_override: "finished" }), "measure", floor())).toBe(
      "Finished measures"
    );
  });

  it("badges an explicit Tight even on a tight floor", () => {
    // Someone chose it on this blind; the choice should be visible where it
    // was made, not silently folded into the floor default.
    expect(labelOf(win({ measure_override: "tight" }), "measure", floor())).toBe("Tight");
  });

  it("badges an explicit 'not noted' measure", () => {
    expect(labelOf(win({ measure_override: "none" }), "measure", floor())).toBe("No meas");
  });

  it("reads the legacy tight_override boolean when the new column is absent", () => {
    expect(labelOf(win({ tight_override: true }), "measure", floor())).toBe("Tight");
    expect(labelOf(win({ tight_override: false }), "measure", floor())).toBe("No meas");
  });

  it("reads a legacy inside_tight mount as tight, and not as a mount", () => {
    const w = win({ mount_override: "inside_tight" });
    expect(labelOf(w, "measure", floor())).toBe("Tight");
    expect(keys(w, floor())).not.toContain("mount");
  });

  it("badges a mount override both ways", () => {
    expect(labelOf(win({ mount_override: "outside" }), "mount", floor())).toBe("Out");
    expect(labelOf(win({ mount_override: "inside" }), "mount", floor())).toBe("In");
  });

  it("badges either control side, not just left", () => {
    expect(labelOf(win({ control_override: "L" }), "control", floor())).toBe("LC");
    expect(labelOf(win({ control_override: "R" }), "control", floor())).toBe("RC");
  });

  it("badges a bay's per-panel control sides left to right", () => {
    const w = win({ widths: [300, 300, 300], panel_controls: ["L", "R", null] });
    // The unset third panel falls back the way the exporter falls back:
    // window override, else the floor's drive side.
    expect(labelOf(w, "panel-controls", floor({ drive: "R" }))).toBe("LRR");
    expect(labelOf(w, "panel-controls", floor({ drive: "L" }))).toBe("LRL");
    expect(titleOf(w, "panel-controls", floor())).toBe("Control side per panel: Left, Right, Right");
  });

  it("ignores stale panel_controls longer than the panel count", () => {
    const w = win({ widths: [480], panel_controls: ["L", "R"] });
    expect(keys(w, floor())).not.toContain("panel-controls");
  });

  it("shows M whether motorization comes from the floor or the window", () => {
    expect(keys(win(), floor({ motorized: true }))).toContain("motor");
    expect(keys(win({ motorized_override: true }), floor({ motorized: false }))).toContain("motor");
  });

  it("strikes M out when this blind opts out of a motorized floor", () => {
    const b = windowBadges(win({ motorized_override: false }), floor({ motorized: true }));
    expect(b.map((x) => x.key)).toContain("motor-off");
    expect(b.find((x) => x.key === "motor-off")?.title).toMatch(/Not motorized/);
    // Never both.
    expect(b.map((x) => x.key)).not.toContain("motor");
  });

  it("says nothing about motors on a floor that has none", () => {
    expect(keys(win({ motorized_override: false }), floor({ motorized: false }))).not.toContain(
      "motor-off"
    );
  });

  it("prefers a chain length over the older longer-chain flag", () => {
    expect(labelOf(win({ chain_length: 48, longer_chain: true }), "chain", floor())).toBe('48"ch');
    expect(labelOf(win({ longer_chain: true }), "chain", floor())).toBe("CH");
  });

  it("badges a per-window note, carrying the text as the title", () => {
    const b = windowBadges(win({ note: "  DRILL HOLES  " }), floor());
    const note = b.find((x) => x.key === "note");
    expect(note?.icon).toBe("note");
    expect(note?.title).toBe("DRILL HOLES");
  });

  it("does not badge a whitespace-only note", () => {
    expect(keys(win({ note: "   " }), floor())).not.toContain("note");
  });

  it("keeps a stable order when a blind carries everything at once", () => {
    const w = win({
      widths: [300, 300],
      deduct: "D",
      panel_controls: ["L", "R"],
      measure_override: "finished",
      mount_override: "outside",
      motorized_override: true,
      chain_length: 36,
      note: "shim",
    });
    expect(keys(w, floor())).toEqual([
      "deduct",
      "panel-controls",
      "measure",
      "mount",
      "motor",
      "chain",
      "note",
    ]);
  });

  it("works without a floor, minus the badges that need one", () => {
    const w = win({ measure_override: "finished", motorized_override: true });
    expect(keys(w)).toEqual(["measure"]);
  });
});
