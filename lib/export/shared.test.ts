import { describe, expect, it } from "vitest";
import { windowMeasure } from "./shared";

describe("windowMeasure: a window's own convention", () => {
  const tightFloor = { tight: true, measure: "tight" as const, mount: null };
  const finishedFloor = { tight: false, measure: "finished" as const, mount: null };
  const unnotedFloor = { tight: false, measure: null, mount: null };

  it("inherits the floor when the window says nothing", () => {
    expect(windowMeasure(tightFloor, undefined, null, null)).toBe("tight");
    expect(windowMeasure(finishedFloor, undefined, null, null)).toBe("finished");
    expect(windowMeasure(unnotedFloor, undefined, null, null)).toBeNull();
  });

  // The whole point of the new column: the boolean it replaces could not say
  // "finished", so a finished window on a tight floor was unrepresentable.
  it("lets one window be finished on a tight floor, and the reverse", () => {
    expect(windowMeasure(tightFloor, undefined, null, "finished")).toBe("finished");
    expect(windowMeasure(finishedFloor, undefined, null, "tight")).toBe("tight");
  });

  it('"none" means don\'t note this one, whatever the floor says', () => {
    expect(windowMeasure(tightFloor, undefined, null, "none")).toBeNull();
    expect(windowMeasure(finishedFloor, undefined, null, "none")).toBeNull();
  });

  // Rows written before the new column carry only the boolean.
  it("still reads the legacy boolean when no override is stored", () => {
    expect(windowMeasure(unnotedFloor, undefined, true, undefined)).toBe("tight");
    expect(windowMeasure(tightFloor, undefined, false, undefined)).toBeNull();
    expect(windowMeasure(tightFloor, undefined, null, undefined)).toBe("tight");
  });

  it("the new column wins over a stale legacy boolean", () => {
    expect(windowMeasure(unnotedFloor, undefined, true, "finished")).toBe("finished");
    expect(windowMeasure(tightFloor, undefined, false, "tight")).toBe("tight");
  });

  // Oldest encoding of all: "inside_tight" sitting in the mount column.
  it("still honours a legacy tight mount", () => {
    expect(windowMeasure(unnotedFloor, "inside_tight", null, undefined)).toBe("tight");
    expect(windowMeasure(unnotedFloor, "inside_tight", null, "none")).toBeNull();
  });
});
