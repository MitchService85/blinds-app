import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { deficienciesToBlob } from "./deficiencies-xlsx";
import { buildDeficiencyRows, DEFICIENCY_HEADERS } from "./deficiencies";

describe("deficienciesToBlob", () => {
  it("writes a title, a header row and one text row per panel", async () => {
    const rows = buildDeficiencyRows([
      {
        label: "Batch 4",
        units: [{
          number: "1410", sort_order: 0,
          windows: [{
            tag_base: "BR", tag_index: 0, widths: [460, 848, 448], height: 928, deduct: "D",
            issue_note: "Left side no deduction, right side shim and 1/4 deduction",
            issue_fault: null, issue_recut: false, sort_order: 0,
          }],
        }],
      },
    ]);
    const blob = await deficienciesToBlob(rows, "Test");
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await blob.arrayBuffer());
    const ws = wb.getWorksheet("Deficiencies")!;
    expect(ws.getRow(1).getCell(1).value).toBe("Test");
    expect(ws.getRow(3).values).toEqual([undefined, ...DEFICIENCY_HEADERS]);
    expect(ws.getRow(4).getCell(5).value).toBe("28 3/4"); // stays text, never 28.75 or a date
    expect(ws.getRow(4).getCell(5).numFmt).toBe("@");
    expect(ws.getRow(5).getCell(8).value).toBe("Shim, 1/4 deduct");
    expect(ws.rowCount).toBe(5);
  });

  it("carries a scope line that says what the file leaves out", async () => {
    // Without it the file is indistinguishable from a measure sheet that
    // dropped blinds — which is how it was read on 44 Charles Batch 5.
    const blob = await deficienciesToBlob([], "Test", "Only blinds flagged: 29 of 74.");
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await blob.arrayBuffer());
    const ws = wb.getWorksheet("Deficiencies")!;
    expect(ws.getRow(2).getCell(1).value).toBe("Only blinds flagged: 29 of 74.");
    // The headers move down with it, and the freeze follows them.
    expect(ws.getRow(4).values).toEqual([undefined, ...DEFICIENCY_HEADERS]);
    expect(ws.views[0]).toMatchObject({ ySplit: 4 });
  });
});
