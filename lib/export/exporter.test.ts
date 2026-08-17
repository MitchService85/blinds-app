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

describe("untagged zone windows (office format)", () => {
  it("exports bare zone label with no dash suffix", async () => {
    const input = {
      project_name: "Alcon 2665 Meadowpine",
      floor_label: "All Areas",
      export_date: "2026-08-12",
      defaults: {
        roll: false, drive: "R" as const, tight: false, extra_note: "",
        d_value: "0.5",
        color_codes: { bed: "", liv: "", studio: "", kitchen: "" },
      },
      units: [{
        number: "Level 1 - FE", status: "done" as const,
        windows: [{
          tag_base: "", tag_index: 0, widths: [1028], height: 1560,
          control_override: null, deduct: null, longer_chain: false,
          note: "Front Entrance", sort_order: 0,
        }],
      }],
    };
    const wb = await buildWorkbook(input);
    const sheet = wb.getWorksheet("Window Shades")!;
    expect(sheet.getCell(10, 1).value).toBe("Level 1 - FE");
    expect(sheet.getCell(10, 5).value).toBe(64.25);
    expect(sheet.getCell(10, 11).value).toBe("Front Entrance");
  });
});

describe("quantity (Q column)", () => {
  const base = {
    project_name: "Cleaveland Clinic - 105 Adelaide St W",
    floor_label: "All Levels",
    export_date: "2026-08-14",
    defaults: {
      roll: false, drive: "R" as const, tight: true, extra_note: "",
      d_value: "0.5",
      color_codes: { bed: "", liv: "", studio: "", kitchen: "" },
    },
  };

  it("writes Q for multi-quantity rows and leaves it empty for singles", async () => {
    const input = {
      ...base,
      units: [{
        number: "L12", status: "done" as const,
        windows: [
          { tag_base: "", tag_index: 0, widths: [690], height: 1384, quantity: 13,
            control_override: null, deduct: null, longer_chain: false, note: "", sort_order: 0 },
          { tag_base: "", tag_index: 0, widths: [472], height: 1328, quantity: 1,
            control_override: null, deduct: null, longer_chain: false, note: "", sort_order: 1 },
        ],
      }],
    };
    const wb = await buildWorkbook(input);
    const sheet = wb.getWorksheet("Window Shades")!;
    expect(sheet.getCell(10, 1).value).toBe("L12");
    expect(sheet.getCell(10, 2).value).toBe(13);   // Q
    expect(sheet.getCell(10, 5).value).toBe(43.125);
    expect(sheet.getCell(11, 2).value).toBeNull(); // single: Q empty
  });
});

describe("panel deducts on bay windows", () => {
  const bay = (deduct: "D" | "Dl" | "Dr" | null, widths: number[]) => ({
    project_name: "P", floor_label: "F", export_date: "2026-08-18",
    defaults: {
      roll: false, drive: "R" as const, tight: false, extra_note: "",
      d_value: "0.5", color_codes: { bed: "", liv: "", studio: "", kitchen: "" },
    },
    units: [{
      number: "1216", status: "done" as const,
      windows: [{ tag_base: "BR", tag_index: 0, widths, height: 928, quantity: 1,
        control_override: null, deduct, longer_chain: false, note: "", sort_order: 0 }],
    }],
  });
  const colJ = async (input: ReturnType<typeof bay>, rows: number) => {
    const wb = await buildWorkbook(input);
    const sheet = wb.getWorksheet("Window Shades")!;
    return Array.from({ length: rows }, (_, i) => sheet.getCell(10 + i, 10).value ?? null);
  };

  it("Both on a 3-panel bay: Dl left, nothing middle, Dr right", async () => {
    expect(await colJ(bay("D", [464, 848, 464]), 3)).toEqual(["Dl", null, "Dr"]);
  });

  it("Left on a 3-panel bay lands only on the left panel", async () => {
    expect(await colJ(bay("Dl", [464, 848, 464]), 3)).toEqual(["Dl", null, null]);
  });

  it("Right on a 3-panel bay lands only on the right panel", async () => {
    expect(await colJ(bay("Dr", [464, 848, 464]), 3)).toEqual([null, null, "Dr"]);
  });

  it("Both on a 2-panel window: Dl then Dr", async () => {
    expect(await colJ(bay("D", [464, 464]), 2)).toEqual(["Dl", "Dr"]);
  });

  it("single panel keeps the stored deduct untouched", async () => {
    expect(await colJ(bay("D", [928]), 1)).toEqual(["D"]);
  });
});
