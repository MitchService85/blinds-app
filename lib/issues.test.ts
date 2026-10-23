import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { deficiencyOpen, hasLegacyIssue, isCrewIssue, legacyIssueId, legacyIssueOpen } from "./issues";

describe("problem state", () => {
  it("a deficiency is open until fixed or removed", () => {
    expect(deficiencyOpen({ status: "open", deleted: false })).toBe(true);
    expect(deficiencyOpen({ status: "resolved", deleted: false })).toBe(false);
    expect(deficiencyOpen({ status: "open", deleted: true })).toBe(false);
  });
  it("tells the crew's problems from a PM's", () => {
    expect(isCrewIssue({ raised_by: "Crew", share_id: null })).toBe(true);
    expect(isCrewIssue({ raised_by: "Anthony", share_id: "s1" })).toBe(false);
  });
  it("reads the window's old single-issue fields", () => {
    const old = { issue_note: "Right side no deduction", issue_fault: null, issue_recut: false };
    expect([hasLegacyIssue(old), legacyIssueOpen(old)]).toEqual([true, true]);
    expect(legacyIssueOpen({ ...old, issue_fixed_at: "2026-10-16T14:14:55Z" })).toBe(false);
    expect(hasLegacyIssue({ issue_note: "  " })).toBe(false);
    expect(hasLegacyIssue({ issue_note: "", issue_recut: true })).toBe(true);
  });
});

describe("legacyIssueId", () => {
  it("matches the server migration's formula, so both make the same row", async () => {
    const w = { id: "0b7b99e5-758c-49c7-be33-4c9e4910307c", issue_note: "No deduct", issue_fault: "factory" as const, issue_recut: false };
    const hex = createHash("sha256").update(`legacy-issue:${w.id}:No deduct:factory:false`).digest("hex").slice(0, 32);
    const id = await legacyIssueId(w);
    expect(id.replace(/-/g, "")).toBe(hex);
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    // Same issue, same id; different note, different id.
    expect(await legacyIssueId(w)).toBe(id);
    expect(await legacyIssueId({ ...w, issue_note: "Stain" })).not.toBe(id);
  });
});
