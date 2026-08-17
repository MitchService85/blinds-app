// Exports a floor's window measurements to the factory "Window Shades"
// workbook format, cell-for-cell matching the delivered Arbour House
// Level 4 file. See docs/superpowers/specs/2026-08-12-measure-app-design.md
// ("Export mapping").
import ExcelJS from "exceljs";
import { floorToEighth, toDecimal } from "../fractions";
import type { ControlOverride, Deduct, FloorDefaults, UnitStatus } from "../types";
import instructionsData from "../../fixtures/instructions-sheet.json";

/** A single window as consumed by the exporter (a plain, already-loaded shape —
 * not the full synced WindowRecord). Multi-panel windows (bay windows) carry
 * more than one entry in `widths`; the exporter emits one row per panel. */
export interface ExportWindow {
  tag_base: string;
  tag_index: number;
  /** Panel widths in integer sixteenths of an inch, left to right. */
  widths: number[];
  /** Height in integer sixteenths of an inch. */
  height: number;
  /** Identical-blind multiplier (template Q column). Absent/1 = single. */
  quantity?: number;
  control_override: ControlOverride;
  deduct: Deduct;
  longer_chain: boolean;
  note: string;
}

export interface ExportUnit {
  number: string;
  status: UnitStatus;
  windows: ExportWindow[];
}

export interface ExportInput {
  project_name: string;
  floor_label: string;
  /** ISO date string, e.g. "2026-08-12". */
  export_date: string;
  defaults: FloorDefaults;
  units: ExportUnit[];
}

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

/**
 * Build the "TIGHT MEASURES. DRILL HOLES IN FASCIA"-style notes string for a
 * single window row: floor-default tight-measures flag, then floor extra
 * note, then the per-window note, then "LONGER CHAIN" when flagged — each
 * additional piece separated from what came before by ". ".
 */
export function buildNoteString(
  defaults: Pick<FloorDefaults, "tight" | "extra_note">,
  windowNote: string,
  longerChain: boolean
): string {
  let note = defaults.tight ? "TIGHT MEASURES" : "";

  const append = (piece: string) => {
    if (!piece) return;
    note = note ? `${note}. ${piece}` : piece;
  };

  append(defaults.extra_note);
  append(windowNote);
  if (longerChain) append("LONGER CHAIN");

  return note;
}

/**
 * Deduct for one panel of a window. Single-panel windows carry the deduct
 * as stored. On a multi-panel bay, fabric can only be trimmed at the
 * window's outer edges: "D" (both) becomes Dl on the leftmost panel's row
 * and Dr on the rightmost; "Dl"/"Dr" land on their outer panel only; middle
 * panels never carry a deduct. (Field request from a PM at 44 Charles:
 * 1/4" off the left of the left blind and the right of the right blind.)
 */
export function panelDeduct(
  deduct: Deduct,
  panelIndex: number,
  panelCount: number
): Deduct {
  if (!deduct || panelCount <= 1) return deduct;
  const first = panelIndex === 0;
  const last = panelIndex === panelCount - 1;
  if (deduct === "D") return first ? "Dl" : last ? "Dr" : null;
  if (deduct === "Dl") return first ? "Dl" : null;
  return last ? "Dr" : null;
}

/**
 * Format a window's room-tag label from its stored tag_base/tag_index,
 * mirroring lib/tags.ts computeTagLabels' base+index semantics: tag_index 0
 * means "unnumbered" (single window of this tag_base) and renders as the
 * plain tag_base; any other tag_index renders as "{tag_base}{tag_index}".
 * The exporter trusts the stored tag_index as already-final — computed live
 * by the app (via computeTagLabels) as windows were added/removed — rather
 * than recomputing group numbering from scratch, so historical/imported data
 * with non-contiguous indices (e.g. a lone survivor renumbered to "BR22" by
 * earlier edits) round-trips exactly.
 */
function windowTagLabel(w: Pick<ExportWindow, "tag_base" | "tag_index">): string {
  return w.tag_index === 0 ? w.tag_base : `${w.tag_base}${w.tag_index}`;
}

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
      const noteString = buildNoteString(input.defaults, w.note, w.longer_chain);

      // Identical-blind multiplier (Cleveland Clinic style). One row per
      // size with the count in Q; a quantity of 1 leaves Q empty, matching
      // every file the factory has accepted.
      const quantity = w.quantity ?? 1;

      w.widths.forEach((widthSixteenths, panelIndex) => {
        sheet.getCell(row, 1).value = tagLabel; // A: Tag/Unit
        if (quantity > 1) sheet.getCell(row, 2).value = quantity; // B: Q
        if (input.defaults.roll) sheet.getCell(row, 4).value = "Rev"; // D: Roll
        sheet.getCell(row, 5).value = toDecimal(floorToEighth(widthSixteenths)); // E: Width
        sheet.getCell(row, 6).value = toDecimal(floorToEighth(w.height)); // F: Height
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
