// Builds the "Invoice summary" workbook for a project's job money (see
// docs/superpowers/plans/2026-08-21-job-money-plan.md). Same shape of module
// as exporter.ts: a pure workbook builder plus a Blob wrapper for the share
// sheet, loaded via dynamic import so ExcelJS stays out of the page bundle.
import ExcelJS from "exceljs";
import { HST_RATE, type Invoice } from "../pricing";

export interface InvoiceFloorSummary {
  label: string;
  blinds: number;
  removed: number;
  trips: number | null;
}

export interface InvoiceExportInput {
  project_name: string;
  address: string;
  /** ISO date string, e.g. "2026-08-21". */
  export_date: string;
  /** Non-empty factory order numbers across the project's floors. */
  order_numbers: string[];
  invoice: Invoice;
  note: string;
  floors: InvoiceFloorSummary[];
}

const SHEET_NAME = "Invoice";
const MONEY_FMT = '"$"#,##0.00';

export function suggestedInvoiceFilename(input: Pick<InvoiceExportInput, "project_name">): string {
  return `${input.project_name} - Invoice.xlsx`;
}

/** Cents to a currency-formatted cell. The workbook is the one place money
 * becomes a decimal — everything upstream stays integer cents. */
function setMoney(cell: ExcelJS.Cell, cents: number) {
  cell.value = cents / 100;
  cell.numFmt = MONEY_FMT;
}

export function buildInvoiceWorkbook(input: InvoiceExportInput): ExcelJS.Workbook {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(SHEET_NAME);

  sheet.getCell("A1").value = input.project_name;
  sheet.getCell("A2").value = input.address;
  sheet.getCell("A3").value = "Date:";
  const dateCell = sheet.getCell("B3");
  dateCell.value = new Date(`${input.export_date}T00:00:00`);
  dateCell.numFmt = "yyyy-mm-dd";
  if (input.order_numbers.length > 0) {
    sheet.getCell("A4").value = "Order #:";
    sheet.getCell("B4").value = input.order_numbers.join(", ");
  }

  sheet.getCell("A6").value = "Item";
  sheet.getCell("B6").value = "Qty";
  sheet.getCell("C6").value = "Rate";
  sheet.getCell("D6").value = "Amount";

  let row = 7;
  for (const line of input.invoice.lines) {
    sheet.getCell(row, 1).value = line.label;
    if (line.qty !== null) sheet.getCell(row, 2).value = line.qty;
    if (line.unit_cents !== null) setMoney(sheet.getCell(row, 3), line.unit_cents);
    setMoney(sheet.getCell(row, 4), line.amount_cents);
    row++;
  }

  row++;
  sheet.getCell(row, 3).value = "Subtotal";
  setMoney(sheet.getCell(row, 4), input.invoice.subtotal_cents);
  row++;
  sheet.getCell(row, 3).value = `HST ${Math.round(HST_RATE * 100)}%`;
  setMoney(sheet.getCell(row, 4), input.invoice.hst_cents);
  row++;
  sheet.getCell(row, 3).value = "Total";
  setMoney(sheet.getCell(row, 4), input.invoice.total_cents);
  row++;

  if (input.note) {
    row++;
    sheet.getCell(row, 1).value = input.note;
    row++;
  }

  // Per-floor appendix: where the counts behind the lines came from, so the
  // invoice can be argued line-by-line on site without opening the app.
  row++;
  sheet.getCell(row, 1).value = "Floor";
  sheet.getCell(row, 2).value = "Blinds";
  sheet.getCell(row, 3).value = "Removed";
  sheet.getCell(row, 4).value = "Trips";
  row++;
  for (const floor of input.floors) {
    sheet.getCell(row, 1).value = floor.label;
    sheet.getCell(row, 2).value = floor.blinds;
    sheet.getCell(row, 3).value = floor.removed;
    if (floor.trips !== null) sheet.getCell(row, 4).value = floor.trips;
    row++;
  }

  return workbook;
}

/** Render an invoice to a Blob, suitable for the phone share sheet. */
export async function exportInvoiceToBlob(input: InvoiceExportInput): Promise<Blob> {
  const workbook = buildInvoiceWorkbook(input);
  const buffer = await workbook.xlsx.writeBuffer();
  return new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}
