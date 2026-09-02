// Invoice page layout. Turns a stored InvoiceRecord into PDF ops; all the
// byte-level work lives in ./pdf.ts, all the money math in ../pricing.ts, so
// this file is only ever about where things sit on the page.
import { formatCents } from "../pricing";
import type { InvoiceRecord } from "../types";
import { formatInvoiceDate } from "./draft";
import {
  imageFromDataUrl,
  measureText,
  renderPdf,
  wrapText,
  type PdfColor,
  type PdfDoc,
  type PdfOp,
} from "./pdf";

const PAGE_W = 612;
const PAGE_H = 792;
const MARGIN = 54;
const RIGHT = PAGE_W - MARGIN;
const BOTTOM = PAGE_H - MARGIN;

// Table columns, all measured from the right edge so the money lines up.
const COL_QTY = 396;
const COL_RATE = 470;
const COL_AMOUNT = RIGHT;
const DESC_WIDTH = COL_QTY - MARGIN - 60;

const INK: PdfColor = [0.1, 0.1, 0.1];
const MUTED: PdfColor = [0.45, 0.45, 0.45];
const RULE: PdfColor = [0.8, 0.8, 0.8];
const DEFAULT_ACCENT: PdfColor = [0.05, 0.43, 0.42];

/** "#0D6E6A" -> [0.05, 0.43, 0.42]. Anything unparseable falls back. */
export function parseHexColor(hex: string, fallback: PdfColor = DEFAULT_ACCENT): PdfColor {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return fallback;
  const n = parseInt(m[1], 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

export interface InvoicePdfInput {
  invoice: InvoiceRecord;
  projectName: string;
  projectAddress: string;
  /** Company accent as a hex string; appearance only, so it is not snapshotted. */
  accentColor?: string;
}

export function suggestedInvoiceFilename(invoice: Pick<InvoiceRecord, "number">): string {
  const safe = invoice.number.trim().replace(/[^\w.-]+/g, "-") || "invoice";
  return `Invoice ${safe}.pdf`;
}

/** A cursor that pushes ops onto the current page and starts a new one when
 * the content runs past the bottom margin. */
class Sheet {
  pages: PdfOp[][] = [[]];
  y = MARGIN;

  get page(): PdfOp[] {
    return this.pages[this.pages.length - 1];
  }

  push(...ops: PdfOp[]) {
    this.page.push(...ops);
  }

  /** Reserve `height` points; break to a new page if they don't fit. */
  need(height: number): boolean {
    if (this.y + height <= BOTTOM) return false;
    this.pages.push([]);
    this.y = MARGIN;
    return true;
  }
}

function textBlock(
  sheet: Sheet,
  text: string,
  x: number,
  size: number,
  leading: number,
  color: PdfColor,
  maxWidth: number
) {
  for (const line of wrapText(text, size, "regular", maxWidth)) {
    if (line) sheet.push({ op: "text", x, y: sheet.y, size, font: "regular", text: line, color });
    sheet.y += leading;
  }
}

function drawHeader(sheet: Sheet, input: InvoicePdfInput, accent: PdfColor, hasLogo: boolean, logoH: number, logoW: number) {
  const { invoice } = input;
  const top = sheet.y;

  // Right column first: the identifying block an AP clerk looks for.
  sheet.push({
    op: "text",
    x: RIGHT,
    y: top + 16,
    size: 24,
    font: "bold",
    text: "INVOICE",
    align: "right",
    color: accent,
  });
  let ry = top + 36;
  const meta: [string, string][] = [
    ["Invoice #", invoice.number],
    ["Date", formatInvoiceDate(invoice.issue_date)],
  ];
  if (invoice.due_date) meta.push(["Due", formatInvoiceDate(invoice.due_date)]);
  if (invoice.terms.trim()) meta.push(["Terms", invoice.terms.trim()]);
  if (invoice.po_number.trim()) meta.push(["PO / Order #", invoice.po_number.trim()]);
  for (const [label, value] of meta) {
    sheet.push(
      { op: "text", x: COL_RATE - 8, y: ry, size: 9, font: "regular", text: label, align: "right", color: MUTED },
      { op: "text", x: RIGHT, y: ry, size: 9, font: "bold", text: value, align: "right", color: INK }
    );
    ry += 13;
  }

  // Left column: who is billing.
  let ly = top;
  if (hasLogo) {
    sheet.push({ op: "image", x: MARGIN, y: ly, w: logoW, h: logoH });
    ly += logoH + 8;
  }
  sheet.push({
    op: "text",
    x: MARGIN,
    y: ly + 11,
    size: 13,
    font: "bold",
    text: invoice.issuer.name,
    color: INK,
  });
  ly += 24;

  sheet.y = ly;
  const contact = [invoice.issuer.address, invoice.issuer.phone, invoice.issuer.email]
    .filter((s) => s.trim())
    .join("\n");
  if (contact) textBlock(sheet, contact, MARGIN, 9, 11.5, MUTED, 240);
  if (invoice.issuer.hst_number.trim()) {
    sheet.push({
      op: "text",
      x: MARGIN,
      y: sheet.y,
      size: 9,
      font: "regular",
      text: `HST/GST #: ${invoice.issuer.hst_number.trim()}`,
      color: MUTED,
    });
    sheet.y += 11.5;
  }

  sheet.y = Math.max(sheet.y, ry) + 12;
  sheet.push({ op: "line", x1: MARGIN, y1: sheet.y, x2: RIGHT, y2: sheet.y, color: RULE });
  sheet.y += 20;
}

function drawParties(sheet: Sheet, input: InvoicePdfInput) {
  const { invoice } = input;
  const top = sheet.y;

  sheet.push({ op: "text", x: MARGIN, y: top, size: 8, font: "bold", text: "BILL TO", color: MUTED });
  sheet.y = top + 14;
  const billTo = invoice.bill_to.trim() || "—";
  textBlock(sheet, billTo, MARGIN, 10, 13, INK, 230);
  const leftEnd = sheet.y;

  // Right half: which job this is for. Kept separate from bill-to because the
  // payer and the site are routinely different parties on these contracts.
  const jobX = 320;
  sheet.push({ op: "text", x: jobX, y: top, size: 8, font: "bold", text: "JOB", color: MUTED });
  sheet.y = top + 14;
  const job = [input.projectName, input.projectAddress].filter((s) => s.trim()).join("\n");
  textBlock(sheet, job || "—", jobX, 10, 13, INK, RIGHT - jobX);

  sheet.y = Math.max(leftEnd, sheet.y) + 16;
}

function drawTableHeader(sheet: Sheet) {
  sheet.push(
    { op: "text", x: MARGIN, y: sheet.y, size: 8, font: "bold", text: "DESCRIPTION", color: MUTED },
    { op: "text", x: COL_QTY, y: sheet.y, size: 8, font: "bold", text: "QTY", align: "right", color: MUTED },
    { op: "text", x: COL_RATE, y: sheet.y, size: 8, font: "bold", text: "RATE", align: "right", color: MUTED },
    { op: "text", x: COL_AMOUNT, y: sheet.y, size: 8, font: "bold", text: "AMOUNT", align: "right", color: MUTED }
  );
  sheet.y += 6;
  sheet.push({ op: "line", x1: MARGIN, y1: sheet.y, x2: RIGHT, y2: sheet.y, color: RULE });
  sheet.y += 14;
}

function drawLines(sheet: Sheet, input: InvoicePdfInput) {
  drawTableHeader(sheet);
  for (const line of input.invoice.lines) {
    const wrapped = wrapText(line.label || "—", 10, "regular", DESC_WIDTH);
    const height = Math.max(1, wrapped.length) * 13 + 4;
    if (sheet.need(height + 60)) drawTableHeader(sheet);

    const baseline = sheet.y;
    wrapped.forEach((text, i) => {
      sheet.push({ op: "text", x: MARGIN, y: baseline + i * 13, size: 10, font: "regular", text, color: INK });
    });
    if (line.qty !== null) {
      sheet.push({
        op: "text",
        x: COL_QTY,
        y: baseline,
        size: 10,
        font: "regular",
        text: String(line.qty),
        align: "right",
        color: INK,
      });
    }
    if (line.unit_cents !== null) {
      sheet.push({
        op: "text",
        x: COL_RATE,
        y: baseline,
        size: 10,
        font: "regular",
        text: formatCents(line.unit_cents),
        align: "right",
        color: INK,
      });
    }
    sheet.push({
      op: "text",
      x: COL_AMOUNT,
      y: baseline,
      size: 10,
      font: "regular",
      text: formatCents(line.amount_cents),
      align: "right",
      color: INK,
    });
    sheet.y = baseline + height;
    sheet.push({ op: "line", x1: MARGIN, y1: sheet.y - 4, x2: RIGHT, y2: sheet.y - 4, width: 0.4, color: [0.9, 0.9, 0.9] });
  }
  sheet.y += 8;
}

function drawTotals(sheet: Sheet, input: InvoicePdfInput, accent: PdfColor) {
  const { invoice } = input;
  sheet.need(96);
  const labelX = COL_RATE;
  const rows: [string, number][] = [
    ["Subtotal", invoice.subtotal_cents],
    [`HST ${Math.round(invoice.hst_rate * 1000) / 10}%`, invoice.hst_cents],
  ];
  for (const [label, cents] of rows) {
    sheet.push(
      { op: "text", x: labelX, y: sheet.y, size: 10, font: "regular", text: label, align: "right", color: MUTED },
      { op: "text", x: COL_AMOUNT, y: sheet.y, size: 10, font: "regular", text: formatCents(cents), align: "right", color: INK }
    );
    sheet.y += 16;
  }

  // The one thing anyone reads twice gets the accent bar.
  const barTop = sheet.y - 4;
  sheet.push({ op: "rect", x: COL_RATE - 96, y: barTop, w: RIGHT - (COL_RATE - 96), h: 26, color: accent });
  sheet.push(
    { op: "text", x: labelX, y: barTop + 17, size: 11, font: "bold", text: "Total due", align: "right", color: [1, 1, 1] },
    {
      op: "text",
      x: COL_AMOUNT - 8,
      y: barTop + 17,
      size: 13,
      font: "bold",
      text: formatCents(invoice.total_cents),
      align: "right",
      color: [1, 1, 1],
    }
  );
  sheet.y = barTop + 26 + 20;
}

function drawFooter(sheet: Sheet, input: InvoicePdfInput) {
  const { invoice } = input;
  const blocks: [string, string][] = [];
  if (invoice.payment_instructions.trim()) blocks.push(["PAYMENT", invoice.payment_instructions.trim()]);
  if (invoice.note.trim()) blocks.push(["NOTES", invoice.note.trim()]);
  for (const [heading, body] of blocks) {
    const lines = wrapText(body, 9, "regular", RIGHT - MARGIN);
    sheet.need(lines.length * 11.5 + 22);
    sheet.push({ op: "text", x: MARGIN, y: sheet.y, size: 8, font: "bold", text: heading, color: MUTED });
    sheet.y += 14;
    textBlock(sheet, body, MARGIN, 9, 11.5, INK, RIGHT - MARGIN);
    sheet.y += 8;
  }
}

export function buildInvoicePdf(input: InvoicePdfInput): PdfDoc {
  const accent = parseHexColor(input.accentColor ?? "");
  const logo = imageFromDataUrl(input.invoice.issuer.logo);
  // Fit the logo into a 150 x 44 box without distorting it.
  let logoW = 0;
  let logoH = 0;
  if (logo) {
    const scale = Math.min(150 / logo.width, 44 / logo.height);
    logoW = logo.width * scale;
    logoH = logo.height * scale;
  }

  const sheet = new Sheet();
  drawHeader(sheet, input, accent, logo !== null, logoH, logoW);
  drawParties(sheet, input);
  drawLines(sheet, input);
  drawTotals(sheet, input, accent);
  drawFooter(sheet, input);

  // Page numbers only once there is more than one page to keep in order.
  if (sheet.pages.length > 1) {
    sheet.pages.forEach((ops, i) => {
      ops.push({
        op: "text",
        x: RIGHT,
        y: BOTTOM + 24,
        size: 8,
        font: "regular",
        text: `${input.invoice.number} — page ${i + 1} of ${sheet.pages.length}`,
        align: "right",
        color: MUTED,
      });
    });
  }

  return {
    width: PAGE_W,
    height: PAGE_H,
    pages: sheet.pages,
    image: logo,
    title: `Invoice ${input.invoice.number}`,
  };
}

export function invoicePdfBytes(input: InvoicePdfInput): Uint8Array {
  return renderPdf(buildInvoicePdf(input));
}

/** Ready for the phone share sheet, same delivery path as the workbooks. */
export function invoicePdfBlob(input: InvoicePdfInput): Blob {
  const bytes = invoicePdfBytes(input);
  return new Blob([bytes as unknown as BlobPart], { type: "application/pdf" });
}

/** Re-exported so callers need only this module to lay out a text column. */
export { measureText };
