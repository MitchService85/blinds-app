import { describe, expect, it } from "vitest";
import { computeInvoice, emptyPricing } from "../pricing";
import {
  buildInvoiceWorkbook,
  suggestedInvoiceFilename,
  type InvoiceExportInput,
} from "./invoice";

/** The Four Seasons job as of entry day, priced with sample rates. */
function fourSeasonsInput(): InvoiceExportInput {
  const side = (q1: number, q2: number, removed: number) => ({
    status: "active" as const,
    removed,
    windows: [
      { widths: [914], quantity: q1 },
      { widths: [920], quantity: q2 },
    ],
  });
  const floors = [
    {
      defaults: {},
      trips: 1,
      units: [side(12, 24, 36), side(4, 9, 13), side(12, 24, 36), side(4, 9, 13)],
    },
  ];
  const invoice = computeInvoice(
    {
      ...emptyPricing(),
      contract_cents: 1_000_000,
      quoted_blind_count: 96,
      removal_per_blind_cents: 500,
      trip_charge_cents: 7_500,
    },
    floors
  );
  return {
    project_name: "Four Seasons",
    address: "1165 Leslie St",
    export_date: "2026-08-21",
    order_numbers: ["A-1023"],
    invoice,
    note: "Install inside contract.",
    floors: [{ label: "Main Floor", blinds: 98, removed: 98, trips: 1 }],
  };
}

describe("buildInvoiceWorkbook", () => {
  it("lays out header, lines, totals, and the floor appendix", () => {
    const workbook = buildInvoiceWorkbook(fourSeasonsInput());
    const sheet = workbook.getWorksheet("Invoice")!;

    expect(sheet.getCell("A1").value).toBe("Four Seasons");
    expect(sheet.getCell("A2").value).toBe("1165 Leslie St");
    expect(sheet.getCell("B4").value).toBe("A-1023");

    // Lines start at row 7: contract, removal (98 x $5), trips (1 x $75).
    expect(sheet.getCell("A7").value).toBe("Contract");
    expect(sheet.getCell("D7").value).toBe(10_000);
    expect(sheet.getCell("A8").value).toBe("Removal of old blinds");
    expect(sheet.getCell("B8").value).toBe(98);
    expect(sheet.getCell("C8").value).toBe(5);
    expect(sheet.getCell("D8").value).toBe(490);
    expect(sheet.getCell("A9").value).toBe("Trip charges");
    expect(sheet.getCell("D9").value).toBe(75);

    // Totals block after a blank row: subtotal $10,565; HST $1,373.45.
    expect(sheet.getCell("C11").value).toBe("Subtotal");
    expect(sheet.getCell("D11").value).toBe(10_565);
    expect(sheet.getCell("C12").value).toBe("HST 13%");
    expect(sheet.getCell("D12").value).toBeCloseTo(1_373.45, 2);
    expect(sheet.getCell("C13").value).toBe("Total");
    expect(sheet.getCell("D13").value).toBeCloseTo(11_938.45, 2);

    // Note, then the appendix table.
    expect(sheet.getCell("A15").value).toBe("Install inside contract.");
    expect(sheet.getCell("A17").value).toBe("Floor");
    expect(sheet.getCell("A18").value).toBe("Main Floor");
    expect(sheet.getCell("B18").value).toBe(98);
    expect(sheet.getCell("C18").value).toBe(98);
    expect(sheet.getCell("D18").value).toBe(1);
  });

  it("keeps money cells currency-formatted", () => {
    const workbook = buildInvoiceWorkbook(fourSeasonsInput());
    const sheet = workbook.getWorksheet("Invoice")!;
    expect(sheet.getCell("D7").numFmt).toBe('"$"#,##0.00');
    expect(sheet.getCell("C8").numFmt).toBe('"$"#,##0.00');
  });

  it("suggests the project-named filename", () => {
    expect(suggestedInvoiceFilename({ project_name: "Four Seasons" })).toBe(
      "Four Seasons - Invoice.xlsx"
    );
  });
});
