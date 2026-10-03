import { describe, expect, it } from "vitest";
import { buildDeficiencyRows, splitNoteByPanel, tidyClause } from "./deficiencies";

describe("tidyClause", () => {
  it("normalises the crew's deduct vocabulary", () => {
    expect(tidyClause("left side no deduction")).toBe("No deduct");
    expect(tidyClause("right side shim and 1/4 deduction")).toBe("Shim, 1/4 deduct");
    expect(tidyClause("Right side no reduction")).toBe("No deduct");
    expect(tidyClause('1/4” reduction on right side')).toBe("1/4 deduct");
    expect(tidyClause("Left side shim no deduction")).toBe("Shim, no deduct");
  });
  it("keeps anything that is not about deducts", () => {
    expect(tidyClause("missing pull tabs")).toBe("Missing pull tabs");
  });
});

describe("splitNoteByPanel", () => {
  it("puts left on panel 1 and right on the last panel", () => {
    const { byPanel, assumed } = splitNoteByPanel("Left side no deduction, right side shim and 1/4 deduction", 3);
    expect(byPanel.get(0)).toBe("No deduct");
    expect(byPanel.get(2)).toBe("Shim, 1/4 deduct");
    expect(byPanel.has(1)).toBe(false);
    expect(assumed).toBe(false);
  });
  it("handles 'both sides'", () => {
    const { byPanel } = splitNoteByPanel("Both sides need shims and no reduction", 3);
    expect(byPanel.get(0)).toBe("Shim, no deduct");
    expect(byPanel.get(2)).toBe("Shim, no deduct");
    expect(byPanel.size).toBe(2);
  });
  it("assumes both outer panels for an unsided deduct note, every panel otherwise", () => {
    const d = splitNoteByPanel("No reduction", 3);
    expect([...d.byPanel.keys()]).toEqual([0, 2]);
    expect(d.assumed).toBe(true);
    const p = splitNoteByPanel("Missing pull tabs", 3);
    expect([...p.byPanel.keys()]).toEqual([0, 1, 2]);
  });
  it("leaves a single blind's note as written", () => {
    expect(splitNoteByPanel("1/4 deduct", 1).byPanel.get(0)).toBe("1/4 deduct");
  });
});

describe("buildDeficiencyRows", () => {
  it("emits one row per affected panel with that panel's width and ordered deduct", () => {
    const rows = buildDeficiencyRows([
      {
        label: "Batch 4",
        units: [
          {
            number: "1410",
            sort_order: 0,
            windows: [
              {
                tag_base: "BR", tag_index: 0, widths: [460, 848, 448], height: 928, deduct: "D",
                issue_note: "Left side no deduction, right side shim and 1/4 deduction",
                issue_fault: null, issue_recut: false, sort_order: 0,
              },
              { tag_base: "LR", tag_index: 1, widths: [556], height: 928, deduct: "Dl",
                issue_note: "", issue_fault: null, issue_recut: false, sort_order: 1 },
            ],
          },
        ],
      },
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ panel: "1 of 3 (left)", width: "28 3/4", deduct_ordered: "Dl", correction: "No deduct" });
    expect(rows[1]).toMatchObject({ panel: "3 of 3 (right)", width: "28", deduct_ordered: "Dr", correction: "Shim, 1/4 deduct" });
  });
});
