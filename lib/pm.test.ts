import { describe, expect, it } from "vitest";
import { pmDate, pmProgress, pmShareUrl, pmTime, pmUnitKind, pmUnitRange, pmWindowLabels } from "./pm";

describe("pmWindowLabels", () => {
  it("names the room and keeps the crew's code, numbered the way the unit screen does", () => {
    const labels = pmWindowLabels({
      windows: [
        { id: "a", tag_base: "LR", sort_order: 0 },
        { id: "b", tag_base: "LR", sort_order: 1 },
        { id: "c", tag_base: "BR", sort_order: 2 },
      ],
    });
    expect(labels.get("a")).toEqual({ name: "Living room 1", code: "LR1" });
    expect(labels.get("b")).toEqual({ name: "Living room 2", code: "LR2" });
    expect(labels.get("c")).toEqual({ name: "Bedroom", code: "BR" });
  });

  it("knows the crew's room words and leaves anything else as typed", () => {
    const labels = pmWindowLabels({
      windows: [
        { id: "m", tag_base: "MBR", sort_order: 0 },
        { id: "k", tag_base: "K", sort_order: 1 },
        { id: "kit", tag_base: "Kit", sort_order: 2 },
        { id: "d", tag_base: "DEN", sort_order: 3 },
        { id: "s", tag_base: "STU", sort_order: 4 },
        { id: "x", tag_base: "Office", sort_order: 5 },
      ],
    });
    expect(labels.get("m")).toEqual({ name: "Main bedroom", code: "MBR" });
    expect(labels.get("k")).toEqual({ name: "Kitchen", code: "K" });
    expect(labels.get("kit")).toEqual({ name: "Kitchen", code: "Kit" });
    expect(labels.get("d")).toEqual({ name: "Den", code: "DEN" });
    expect(labels.get("s")).toEqual({ name: "Study", code: "STU" });
    expect(labels.get("x")).toEqual({ name: "Office", code: "" });
  });

  it("numbers untagged zone-run windows by position", () => {
    const labels = pmWindowLabels({
      windows: [
        { id: "a", tag_base: "", sort_order: 0 },
        { id: "b", tag_base: "", sort_order: 1 },
      ],
    });
    expect(labels.get("a")).toEqual({ name: "Blind 1", code: "" });
    expect(labels.get("b")).toEqual({ name: "Blind 2", code: "" });
  });
});

describe("pmProgress", () => {
  const u = (done: boolean, blocked = false, locked = false) => ({ done, blocked, locked });

  it("counts a unit complete only when it is installed and nothing is waiting on it", () => {
    expect(pmProgress([u(true), u(false), u(true), u(true, true), u(true, false, true)])).toEqual({
      complete: 2,
      total: 5,
      fixing: 1,
      noAccess: 1,
    });
    expect(pmProgress([])).toEqual({ complete: 0, total: 0, fixing: 0, noAccess: 0 });
  });

  it("counts every amber tile as being fixed, installed or not, and a locked one only as no access", () => {
    expect(pmProgress([u(false, true), u(true, true), u(true, true, true)])).toEqual({
      complete: 0,
      total: 3,
      fixing: 2,
      noAccess: 1,
    });
  });
});

describe("pmUnitKind", () => {
  const open = { id: "d", window_id: null, note: "x", status: "open" as const, raised_at: "2026-10-20T13:00:00Z" };
  const fixed = { ...open, status: "resolved" as const };

  it("says whose reason a revisit is without giving the crew's", () => {
    expect(pmUnitKind({ done: true, blocked: true, locked: false, deficiencies: [open] })).toBe("yourReport");
    expect(pmUnitKind({ done: true, blocked: true, locked: false, deficiencies: [fixed] })).toBe("returnVisit");
    expect(pmUnitKind({ done: true, blocked: true, locked: false, deficiencies: [] })).toBe("returnVisit");
  });

  it("puts locked first, then complete or not yet", () => {
    expect(pmUnitKind({ done: true, blocked: true, locked: true, deficiencies: [open] })).toBe("locked");
    expect(pmUnitKind({ done: true, blocked: false, locked: false, deficiencies: [fixed] })).toBe("complete");
    expect(pmUnitKind({ done: false, blocked: false, locked: false, deficiencies: [] })).toBe("notYet");
  });
});

describe("pmDate / pmTime / pmUnitRange", () => {
  it("formats the way the page reads", () => {
    expect(pmDate(new Date(2026, 9, 20, 9, 5).toISOString())).toBe("Oct 20");
    expect(pmTime(new Date(2026, 9, 20, 14, 4))).toBe("2:04 pm");
    expect(pmTime(new Date(2026, 9, 20, 0, 30))).toBe("12:30 am");
    expect(pmTime(new Date(2026, 9, 20, 12, 0))).toBe("12:00 pm");
  });

  it("gives the first and last unit on a floor", () => {
    expect(pmUnitRange([{ number: "1201" }, { number: "1202" }, { number: "1312" }])).toBe("units 1201–1312");
    expect(pmUnitRange([{ number: "1201" }])).toBe("unit 1201");
    expect(pmUnitRange([])).toBe("");
  });
});

describe("pmShareUrl", () => {
  it("builds an absolute link and tolerates a trailing slash on the origin", () => {
    expect(pmShareUrl("abc", "https://measure.example/")).toBe("https://measure.example/pm/abc");
    expect(pmShareUrl("abc", "https://measure.example")).toBe("https://measure.example/pm/abc");
  });
});
