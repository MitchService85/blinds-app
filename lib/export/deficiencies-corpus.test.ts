import { describe, expect, it } from "vitest";
import { splitNoteByPanel } from "./deficiencies";

/**
 * Every bay note (3-panel window) the crews had actually written as of
 * 2026-10-07, verbatim — typos, curly quotes, trailing spaces and all — and
 * how each lands on the factory's panels. The splitter is free-text parsing,
 * so the honest test of it is the text it really gets.
 *
 *   [left, middle, right], `null` = no row for that panel.
 */
const CORPUS: [string, [string | null, string | null, string | null], boolean][] = [
  ["Both sides need shims and no reduction", ["Shim, no deduct", null, "Shim, no deduct"], false],
  ["Left blind no reduction", ["No deduct", null, null], false],
  ["Left need shim and 1/4 reduction", ["Shim, 1/4 deduct", null, null], false],
  ["Left shim no deduction, right side shim and 1/4 deduction", ["Shim, no deduct", null, "Shim, 1/4 deduct"], false],
  ["Left side no deduct, right side no deduct", ["No deduct", null, "No deduct"], false],
  ["Left side no deduction", ["No deduct", null, null], false],
  ["Left side no deduction, right side no deduction", ["No deduct", null, "No deduct"], false],
  ["Left side no deduction, right side shim and 1/4 deduction", ["No deduct", null, "Shim, 1/4 deduct"], false],
  ["Left side no reduction, 1/4” reduction on right side", ["No deduct", null, "1/4 deduct"], false],
  ["Left side no reduction, right side shim no reduction", ["No deduct", null, "Shim, no deduct"], false],
  ["Left side shim and 1/4 deduct, right side no deduction ", ["Shim, 1/4 deduct", null, "No deduct"], false],
  ["Left side shim and 1/4 deduction, Right side no deduction", ["Shim, 1/4 deduct", null, "No deduct"], false],
  ["Left side shim no deduction, Right side shim no deduction", ["Shim, no deduct", null, "Shim, no deduct"], false],
  // Not about deducts, so it is every panel — and it names no side.
  ["Missing pull tabs", ["Missing pull tabs", "Missing pull tabs", "Missing pull tabs"], true],
  // About deducts but names no side: both outer panels, flagged as assumed.
  ["No reduction ", ["No deduct", null, "No deduct"], true],
  ["Right side no deduct", [null, null, "No deduct"], false],
  ["Right side no deduction", [null, null, "No deduct"], false],
  ["Right side no reduction", [null, null, "No deduct"], false],
  ["Right side shim and no deduct", [null, null, "Shim, no deduct"], false],
];

describe("splitNoteByPanel on the real field notes", () => {
  it.each(CORPUS)("%s", (note, [left, middle, right], assumed) => {
    const out = splitNoteByPanel(note, 3);
    expect([0, 1, 2].map((i) => out.byPanel.get(i) ?? null)).toEqual([left, middle, right]);
    expect(out.assumed).toBe(assumed);
  });

  it("splits '… and left …' / '… and right …' without a phantom clause", () => {
    expect(splitNoteByPanel("Shim on right and left side no deduct", 3).byPanel).toEqual(
      new Map([[2, "Shim"], [0, "No deduct"]])
    );
  });
});
