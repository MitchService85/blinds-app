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
});
