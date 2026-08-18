// Exports a floor's window measurements to the factory "Window Shades"
// workbook format, cell-for-cell matching the delivered Arbour House
// Level 4 file. See docs/superpowers/specs/2026-08-12-measure-app-design.md
// ("Export mapping").
import ExcelJS from "exceljs";
import instructionsData from "../../fixtures/instructions-sheet.json";
import {
  buildNoteString,
  exportedSize,
  panelDeduct,
  windowTagLabel,
  type ExportInput,
} from "./shared";

// Re-exported so existing importers (and exporter.test.ts) are unaffected by
// the split between the pure conventions and the workbook writer.
export {
  buildNoteString,
  effectiveMount,
  exportedSize,
  panelDeduct,
  windowTagLabel,
} from "./shared";
export type { ExportInput, ExportUnit, ExportWindow } from "./shared";

const SHEET_NAME = "Window Shades";
const INSTRUCTIONS_SHEET_NAME = "Instructions";

const HEADER_ROW = [
  "Tag/Unit",
  "Q",
  "Product",
  "Roll",
  "Width",
  "Height",
  "Chain ",
  "Fabric",
  "Control",
  "Deducts ",
  "NOTES",
];

const DATA_START_ROW = 10;

/** Suggested export filename per spec: "{project_name} - {floor_label}.xlsx". */
export function suggestedFilename(
  input: Pick<ExportInput, "project_name" | "floor_label">
): string {
  return `${input.project_name} - ${input.floor_label}.xlsx`;
}

function setIfPresent(cell: ExcelJS.Cell, value: string | undefined | null) {
  if (value) cell.value = value;
}

function buildInstructionsSheet(workbook: ExcelJS.Workbook) {
  const sheet = workbook.addWorksheet(INSTRUCTIONS_SHEET_NAME);
  for (const [ref, value] of Object.entries(instructionsData as Record<string, ExcelJS.CellValue>)) {
    sheet.getCell(ref).value = value;
  }
}

/**
 * Build the full export workbook ("Window Shades" + "Instructions" sheets)
 * for a floor. Pure function — no I/O.
 */
export function buildWorkbook(input: ExportInput): ExcelJS.Workbook {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(SHEET_NAME);

  sheet.getCell("A1").value = "NOTES:";
  sheet.getCell("A2").value = "Deducts: Dl = Left side, Dr = Right side, D = Both sides";
  sheet.getCell("A3").value = "Tag/Unit can be blank - blank rows belong to previous unit";
  sheet.getCell("A4").value = "D value in I7 is TOTAL for both sides (Dl and Dr are each D/2)";

  sheet.getCell("F1").value = "Project Name:";
  sheet.getCell("G1").value = `${input.project_name} - ${input.floor_label}`;

  sheet.getCell("F2").value = "Date:";
  const dateCell = sheet.getCell("G2");
  dateCell.value = new Date(`${input.export_date}T00:00:00`);
  dateCell.numFmt = "yyyy-mm-dd";

  sheet.getCell("F3").value = "Bed =";
  setIfPresent(sheet.getCell("G3"), input.defaults.color_codes.bed);
  sheet.getCell("F4").value = "Liv =";
  setIfPresent(sheet.getCell("G4"), input.defaults.color_codes.liv);
  sheet.getCell("F5").value = "Studio =";
  setIfPresent(sheet.getCell("G5"), input.defaults.color_codes.studio);
  sheet.getCell("F6").value = "Kitchen =";
  setIfPresent(sheet.getCell("G6"), input.defaults.color_codes.kitchen);

  sheet.getCell("I7").value = `D = ${input.defaults.d_value}`;
  sheet.getCell("K8").value = "Mounting Type (inside/ outside) ";

  HEADER_ROW.forEach((heading, i) => {
    sheet.getCell(9, i + 1).value = heading;
  });

  let row = DATA_START_ROW;
  for (const unit of input.units) {
    if (unit.status === "na") continue;

    unit.windows.forEach((w) => {
      // Untagged windows (office/zone runs like Alcon) export as the bare
      // unit/zone label — no "-" suffix.
      const tag = windowTagLabel(w);
      const tagLabel = tag ? `${unit.number}-${tag}` : unit.number;
      const control = w.control_override ?? input.defaults.drive;
      const noteString = buildNoteString(
        input.defaults,
        w.note,
        w.longer_chain,
        w.mount_override,
        {
          tightOverride: w.tight_override,
          motorizedOverride: w.motorized_override,
          chainLength: w.chain_length,
        }
      );
      // Chain column (G) per the template's Instructions sheet: a length value.
      const chainLength =
        typeof w.chain_length === "number" && w.chain_length > 0 ? w.chain_length : null;

      // Identical-blind multiplier (Cleveland Clinic style). One row per
      // size with the count in Q; a quantity of 1 leaves Q empty, matching
      // every file the factory has accepted.
      const quantity = w.quantity ?? 1;

      w.widths.forEach((widthSixteenths, panelIndex) => {
        sheet.getCell(row, 1).value = tagLabel; // A: Tag/Unit
        if (quantity > 1) sheet.getCell(row, 2).value = quantity; // B: Q
        if (input.defaults.roll) sheet.getCell(row, 4).value = "Rev"; // D: Roll
        if (chainLength !== null) sheet.getCell(row, 7).value = chainLength; // G: Chain
        sheet.getCell(row, 5).value = exportedSize(widthSixteenths); // E: Width
        sheet.getCell(row, 6).value = exportedSize(w.height); // F: Height
        sheet.getCell(row, 9).value = control; // I: Control
        const deduct = panelDeduct(w.deduct, panelIndex, w.widths.length);
        if (deduct) sheet.getCell(row, 10).value = deduct; // J: Deducts
        if (noteString) sheet.getCell(row, 11).value = noteString; // K: Notes
        row++;
      });
    });
  }

  buildInstructionsSheet(workbook);

  return workbook;
}

/** Render a floor export to a Blob, suitable for the phone share sheet. */
export async function exportFloorToBlob(input: ExportInput): Promise<Blob> {
  const workbook = buildWorkbook(input);
  const buffer = await workbook.xlsx.writeBuffer();
  return new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}
