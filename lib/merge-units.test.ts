import { describe, expect, it } from "vitest";
import { findDuplicateUnitNumbers, planUnitMerge } from "./merge-units";
import type { Unit } from "./types";

const unit = (patch: Partial<Unit>): Unit => ({
  id: "u1", updated_at: "", deleted: false, floor_id: "f1",
  number: "405", status: "active", note: "", install: null,
  install_blocked: false, sort_order: 0, ...patch,
});

describe("findDuplicateUnitNumbers", () => {
  it("finds a number created on both phones", () => {
    const d = findDuplicateUnitNumbers([
      unit({ id: "a", number: "405" }),
      unit({ id: "b", number: "405" }),
      unit({ id: "c", number: "406" }),
    ]);
    expect([...d.keys()]).toEqual(["405"]);
    expect(d.get("405")).toEqual(["a", "b"]);
  });

  it("treats whitespace variants as the same number", () => {
    const d = findDuplicateUnitNumbers([
      unit({ id: "a", number: "405" }),
      unit({ id: "b", number: " 405 " }),
    ]);
    expect(d.get("405")).toHaveLength(2);
  });

  it("ignores blank numbers and non-duplicates", () => {
    const d = findDuplicateUnitNumbers([
      unit({ id: "a", number: "" }),
      unit({ id: "b", number: "" }),
      unit({ id: "c", number: "406" }),
    ]);
    expect(d.size).toBe(0);
  });
});

describe("planUnitMerge", () => {
  it("keeps both punch-list notes", () => {
    const plan = planUnitMerge(
      unit({ note: "needs fascia" }),
      unit({ id: "u2", note: "PRIORITY" })
    );
    expect(plan.note).toBe("needs fascia / PRIORITY");
  });

  it("does not duplicate an identical note", () => {
    const plan = planUnitMerge(unit({ note: "shim" }), unit({ id: "u2", note: "shim" }));
    expect(plan.note).toBe("shim");
  });

  it("stays done only when both halves were done", () => {
    expect(planUnitMerge(unit({ status: "done" }), unit({ id: "u2", status: "done" })).status).toBe("done");
    expect(planUnitMerge(unit({ status: "done" }), unit({ id: "u2", status: "active" })).status).toBe("active");
  });

  it("takes the least-finished install state", () => {
    expect(planUnitMerge(unit({ install: "done" }), unit({ id: "u2", install: null })).install).toBeNull();
    expect(planUnitMerge(unit({ install: "staged" }), unit({ id: "u2", install: "done" })).install).toBe("staged");
  });

  it("a blocked flag on either side survives", () => {
    expect(
      planUnitMerge(unit({}), unit({ id: "u2", install_blocked: true, note: "no access" })).install_blocked
    ).toBe(true);
  });
});
