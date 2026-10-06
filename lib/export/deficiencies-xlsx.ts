// Workbook writer for the deficiency export. Loaded by dynamic import so
// ExcelJS stays out of the page bundle (same split as exporter.ts).
import ExcelJS from "exceljs";
import { DEFICIENCY_HEADERS, rowCells, type DeficiencyRow } from "./deficiencies";

export async function deficienciesToBlob(
  rows: DeficiencyRow[],
  title: string,
  /**
   * What this file leaves out, in words — e.g. "Only blinds flagged with an
   * issue: 29 of 74 blinds on Batch 5."
   *
   * The sheet lists flagged blinds only, so a room measured BR1/BR2/BR3 with
   * a note on the outer two appears as BR1 and BR3 with BR2 absent. That
   * reads exactly like an export that dropped blinds — reported as one
   * (2026-10-06, 44 Charles Batch 5) by someone holding the file a week
   * later with nothing on it to say which of the two exports it was. The
   * filename says "Deficiencies"; this says it again where it is being read,
   * with the arithmetic that explains the gaps.
   */
  subtitle?: string
): Promise<Blob> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Deficiencies");
  ws.addRow([title]).font = { bold: true, size: 12 };
  if (subtitle) ws.addRow([subtitle]).font = { italic: true, color: { argb: "FF806000" } };
  ws.addRow([]);
  const header = ws.addRow([...DEFICIENCY_HEADERS]);
  header.font = { bold: true };
  for (const r of rows) ws.addRow(rowCells(r));
  // Everything is text on purpose: "28 3/4" and "1/4 deduct" must never be
  // parsed as dates or numbers by whatever opens this.
  ws.columns.forEach((col, i) => {
    col.width = [10, 8, 8, 16, 11, 11, 10, 30, 10, 7, 13, 16][i] ?? 12;
    col.eachCell?.({ includeEmpty: false }, (cell) => {
      if (typeof cell.value === "string") cell.numFmt = "@";
    });
  });
  ws.views = [{ state: "frozen", ySplit: header.number }];
  const buf = await wb.xlsx.writeBuffer();
  return new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}
