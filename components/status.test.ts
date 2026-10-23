import { describe, expect, it } from "vitest";
import { deriveInstallState, isBlocked, unitsWithOutstanding } from "./status";

const unit = (install: "staged" | "done" | null, install_blocked = false) => ({
  status: "done" as const, install, install_blocked, locked: false,
});

describe("outstanding deficiencies block an installed unit", () => {
  const windows = [
    { unit_id: "u1", deleted: false, issue_note: "Right side no deduction", issue_fault: null, issue_recut: false },
    { unit_id: "u2", deleted: false, issue_note: "", issue_fault: null, issue_recut: false },
    { unit_id: "u3", deleted: true, issue_note: "gone", issue_fault: null, issue_recut: false },
    { unit_id: "u4", deleted: false, issue_note: "  ", issue_fault: "factory" as const, issue_recut: false },
  ];
  const defs = [
    { unit_id: "u5", status: "open" as const, deleted: false },
    { unit_id: "u6", status: "resolved" as const, deleted: false },
  ];

  it("collects ⚠ blinds and open PM deficiencies only", () => {
    expect([...unitsWithOutstanding(windows, defs)].sort()).toEqual(["u1", "u4", "u5"]);
  });

  it("turns a done unit yellow, and leaves a not-started one alone", () => {
    expect(deriveInstallState(unit("done"), true)).toBe("blocked");
    expect(deriveInstallState(unit("staged"), true)).toBe("blocked");
    expect(deriveInstallState(unit(null), true)).toBe("not_started");
    expect(deriveInstallState(unit("done"), false)).toBe("done");
  });

  it("still honours a hand-set block", () => {
    expect(isBlocked(unit(null, true))).toBe(true);
    expect(isBlocked(unit("done", false), false)).toBe(false);
  });
});

describe("a fixed issue is a record, not outstanding", () => {
  it("does not hold the unit yellow", () => {
    const windows = [
      { unit_id: "u1", deleted: false, issue_note: "Right side no deduction", issue_fault: null, issue_recut: false, issue_fixed_at: "2026-10-23T14:00:00Z" },
      { unit_id: "u2", deleted: false, issue_note: "Right side no deduction", issue_fault: null, issue_recut: false, issue_fixed_at: null },
    ];
    expect([...unitsWithOutstanding(windows)]).toEqual(["u2"]);
  });
});
