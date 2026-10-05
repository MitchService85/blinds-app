// Workbook writer for the deficiency export. Loaded by dynamic import so
// ExcelJS stays out of the page bundle (same split as exporter.ts).
import ExcelJS from "exceljs";
import { DEFICIENCY_HEADERS, rowCells, type DeficiencyRow } from "./deficiencies";

export async function deficienciesToBlob(rows: DeficiencyRow[], title: string): Promise<Blob> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Deficiencies");
  ws.addRow([title]).font = { bold: true, size: 12 };
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
  ws.views = [{ state: "frozen", ySplit: 3 }];
  const buf = await wb.xlsx.writeBuffer();
  return new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}
