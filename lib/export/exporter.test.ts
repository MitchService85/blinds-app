import { describe, expect, it } from "vitest";
import type ExcelJS from "exceljs";
import { buildWorkbook, suggestedFilename, type ExportInput } from "./exporter";
import inputFixture from "../../fixtures/level4-input.json";
import goldenFixture from "../../fixtures/level4-golden.json";

const golden: Record<string, unknown> = goldenFixture;

/** Excel dates come back as JS Date objects; the golden fixture stores them
 * as "yyyy-mm-dd" strings, so normalize before comparing. */
function formatCellValue(value: ExcelJS.CellValue): unknown {
  if (value instanceof Date) {
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, "0");
    const d = String(value.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  return value;
}

function isEmpty(value: ExcelJS.CellValue): boolean {
  return value === null || value === undefined || value === "";
}

describe("buildWorkbook golden file (Arbour House Level 4)", () => {
  const workbook = buildWorkbook(inputFixture as ExportInput);
  const sheet = workbook.getWorksheet("Window Shades");
  if (!sheet) throw new Error('Expected a "Window Shades" worksheet');

  it("matches every cell in the golden fixture", () => {
    const mismatches: string[] = [];
    for (const [ref, expected] of Object.entries(golden)) {
      const actual = formatCellValue(sheet.getCell(ref).value);
      if (actual !== expected) {
        mismatches.push(`${ref}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
      }
    }
    expect(mismatches, `Cell mismatches:\n${mismatches.join("\n")}`).toEqual([]);
  });

  it("has no extra non-empty cells in the data region (rows 10+, cols A-O)", () => {
    const extras: string[] = [];
    sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      if (rowNumber < 10) return;
      row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
        if (colNumber > 15) return; // O = 15
        const ref = cell.address;
        if (!(ref in golden) && !isEmpty(cell.value)) {
          extras.push(`${ref}: ${JSON.stringify(formatCellValue(cell.value))}`);
        }
      });
    });
    expect(extras, `Unexpected extra cells:\n${extras.join("\n")}`).toEqual([]);
  });

  it("includes an Instructions sheet", () => {
    expect(workbook.getWorksheet("Instructions")).toBeDefined();
  });
});

describe("suggestedFilename", () => {
  it('builds "{project_name} - {floor_label}.xlsx"', () => {
    expect(
      suggestedFilename({ project_name: "Arbour House 15 Neighborhood Lane", floor_label: "Level 4" })
    ).toBe("Arbour House 15 Neighborhood Lane - Level 4.xlsx");
  });
});
