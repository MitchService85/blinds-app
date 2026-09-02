/**
 * A minimal PDF writer — enough for an invoice and deliberately no more.
 *
 * Hand-written rather than a library because the whole surface an invoice
 * needs is text, rules, a filled box and one JPEG: a few hundred lines that
 * add nothing to the bundle, run offline on a job site, and emit bytes, which
 * means the layout above can be tested exactly rather than eyeballed.
 *
 * Coordinates in this module are top-left origin, y growing downward, because
 * that is how the layout code thinks. The conversion to PDF's bottom-left
 * origin happens once, here.
 */

export type PdfFont = "regular" | "bold";
export type PdfAlign = "left" | "right" | "center";
/** r, g, b in 0..1. */
export type PdfColor = [number, number, number];

export type PdfOp =
  | {
      op: "text";
      x: number;
      y: number;
      size: number;
      font: PdfFont;
      text: string;
      align?: PdfAlign;
      color?: PdfColor;
    }
  | { op: "line"; x1: number; y1: number; x2: number; y2: number; width?: number; color?: PdfColor }
  | { op: "rect"; x: number; y: number; w: number; h: number; color: PdfColor }
  | { op: "image"; x: number; y: number; w: number; h: number };

export interface PdfImage {
  bytes: Uint8Array;
  width: number;
  height: number;
  /** 1 = grayscale, 3 = RGB. CMYK JPEGs are rejected by parseJpeg. */
  components: number;
}

export interface PdfDoc {
  /** Points. US Letter is 612 x 792. */
  width: number;
  height: number;
  pages: PdfOp[][];
  /** At most one image, referenced by every `image` op. */
  image?: PdfImage | null;
  title?: string;
}

// ---------------------------------------------------------------------------
// Font metrics
// ---------------------------------------------------------------------------

// Helvetica and Helvetica-Bold advance widths (1/1000 em) for the printable
// ASCII range. Only used to align money columns and centre headings, so a
// character outside the table falls back to a plausible width rather than
// throwing — a hair of drift beats a failed render.
const HELVETICA = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
  1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
  333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556,
  556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
];
const HELVETICA_BOLD = [
  278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611,
  975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556,
  333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611,
  611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584,
];

function charWidth(code: number, font: PdfFont): number {
  const table = font === "bold" ? HELVETICA_BOLD : HELVETICA;
  if (code >= 32 && code <= 126) return table[code - 32];
  // Latin-1 accents and the typographic punctuation we map below are all
  // roughly letter-width; the em dash is the one that would look wrong narrow.
  if (code === 0x97) return font === "bold" ? 1000 : 1000;
  if (code === 0x96) return 556;
  return font === "bold" ? 611 : 556;
}

/** Width of `text` at `size` points. */
export function measureText(text: string, size: number, font: PdfFont): number {
  let total = 0;
  for (const byte of winAnsiBytes(text)) total += charWidth(byte, font);
  return (total * size) / 1000;
}

/** Greedy wrap to `maxWidth`, honouring newlines already in the text. */
export function wrapText(
  text: string,
  size: number,
  font: PdfFont,
  maxWidth: number
): string[] {
  const out: string[] = [];
  for (const paragraph of text.split(/\r?\n/)) {
    if (paragraph.trim() === "") {
      out.push("");
      continue;
    }
    let line = "";
    for (const word of paragraph.split(/\s+/)) {
      const candidate = line ? `${line} ${word}` : word;
      if (line && measureText(candidate, size, font) > maxWidth) {
        out.push(line);
        line = word;
      } else {
        line = candidate;
      }
    }
    if (line) out.push(line);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Encoding
// ---------------------------------------------------------------------------

// Characters that a phone keyboard produces constantly and that WinAnsi
// encodes outside Latin-1's own slots. Anything still unmapped becomes "?"
// rather than a mojibake byte.
const WIN_ANSI_EXTRAS: Record<string, number> = {
  "€": 0x80,
  "‚": 0x82,
  "ƒ": 0x83,
  "„": 0x84,
  "…": 0x85,
  "†": 0x86,
  "‡": 0x87,
  "‰": 0x89,
  "‹": 0x8b,
  "‘": 0x91,
  "’": 0x92,
  "“": 0x93,
  "”": 0x94,
  "•": 0x95,
  "–": 0x96,
  "—": 0x97,
  "™": 0x99,
  "›": 0x9b,
};

function winAnsiBytes(text: string): number[] {
  const out: number[] = [];
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 63;
    if (code === 9) {
      out.push(32);
    } else if (code >= 32 && code <= 126) {
      out.push(code);
    } else if (WIN_ANSI_EXTRAS[ch] !== undefined) {
      out.push(WIN_ANSI_EXTRAS[ch]);
    } else if (code >= 0xa0 && code <= 0xff) {
      out.push(code);
    } else {
      out.push(63);
    }
  }
  return out;
}

/** A PDF literal string: WinAnsi bytes with the three reserved chars escaped. */
function pdfString(text: string): string {
  let out = "(";
  for (const byte of winAnsiBytes(text)) {
    if (byte === 0x28 || byte === 0x29 || byte === 0x5c) out += `\\${String.fromCharCode(byte)}`;
    else out += String.fromCharCode(byte);
  }
  return `${out})`;
}

function latin1(text: string): Uint8Array {
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i) & 0xff;
  return bytes;
}

/** Trim trailing zeros so the content stream stays readable and small. */
function num(n: number): string {
  return (Math.round(n * 100) / 100).toString();
}

function colorOp(color: PdfColor | undefined, stroke: boolean): string {
  const [r, g, b] = color ?? [0, 0, 0];
  return `${num(r)} ${num(g)} ${num(b)} ${stroke ? "RG" : "rg"}\n`;
}

// ---------------------------------------------------------------------------
// JPEG
// ---------------------------------------------------------------------------

/**
 * Read the dimensions and component count out of a baseline JPEG so it can be
 * embedded as a DCTDecode XObject — no re-encoding, the original bytes go
 * straight into the file. Returns null for anything unreadable (a progressive
 * or CMYK JPEG, a PNG someone pasted in), and the caller simply omits the
 * logo rather than failing the whole invoice.
 */
export function parseJpeg(bytes: Uint8Array): PdfImage | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < bytes.length) {
    if (bytes[i] !== 0xff) {
      i++;
      continue;
    }
    const marker = bytes[i + 1];
    // Standalone markers carry no length payload.
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2;
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) return null;
    const length = (bytes[i + 2] << 8) | bytes[i + 3];
    // SOF0/1/2 (baseline, extended, progressive). DCTDecode handles all three;
    // SOF3 and the arithmetic-coded variants it does not.
    if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) {
      const components = bytes[i + 9];
      if (components !== 1 && components !== 3) return null;
      return {
        bytes,
        height: (bytes[i + 5] << 8) | bytes[i + 6],
        width: (bytes[i + 7] << 8) | bytes[i + 8],
        components,
      };
    }
    if (length < 2) return null;
    i += 2 + length;
  }
  return null;
}

/** "data:image/jpeg;base64,..." -> an embeddable image, or null. */
export function imageFromDataUrl(dataUrl: string): PdfImage | null {
  const m = /^data:image\/jpe?g;base64,(.+)$/i.exec(dataUrl.trim());
  if (!m) return null;
  try {
    const binary = atob(m[1]);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return parseJpeg(bytes);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

function contentStream(ops: PdfOp[], pageHeight: number, hasImage: boolean): string {
  // Flip once, here: layout code above works in top-left coordinates.
  const flip = (y: number) => pageHeight - y;
  let out = "";
  for (const op of ops) {
    if (op.op === "text") {
      if (!op.text) continue;
      const width = measureText(op.text, op.size, op.font);
      const x =
        op.align === "right"
          ? op.x - width
          : op.align === "center"
            ? op.x - width / 2
            : op.x;
      out += colorOp(op.color, false);
      out += `BT /${op.font === "bold" ? "F2" : "F1"} ${num(op.size)} Tf 1 0 0 1 ${num(x)} ${num(flip(op.y))} Tm ${pdfString(op.text)} Tj ET\n`;
    } else if (op.op === "line") {
      out += colorOp(op.color, true);
      out += `${num(op.width ?? 0.75)} w ${num(op.x1)} ${num(flip(op.y1))} m ${num(op.x2)} ${num(flip(op.y2))} l S\n`;
    } else if (op.op === "rect") {
      out += colorOp(op.color, false);
      out += `${num(op.x)} ${num(flip(op.y + op.h))} ${num(op.w)} ${num(op.h)} re f\n`;
    } else if (op.op === "image" && hasImage) {
      out += `q ${num(op.w)} 0 0 ${num(op.h)} ${num(op.x)} ${num(flip(op.y + op.h))} cm /Im0 Do Q\n`;
    }
  }
  return out;
}

/** Serialise a document to PDF bytes. */
export function renderPdf(doc: PdfDoc): Uint8Array {
  const image = doc.image ?? null;
  const pageCount = Math.max(1, doc.pages.length);
  const pages = doc.pages.length > 0 ? doc.pages : [[]];

  // Object numbering: 1 catalog, 2 pages, 3-4 fonts, 5 image (when present),
  // then a page object and a content object per page.
  const imageObj = image ? 5 : 0;
  const firstPageObj = image ? 6 : 5;
  const pageObjNum = (i: number) => firstPageObj + i * 2;
  const contentObjNum = (i: number) => firstPageObj + i * 2 + 1;

  const chunks: Uint8Array[] = [];
  const offsets: number[] = [];
  let length = 0;
  const push = (bytes: Uint8Array) => {
    chunks.push(bytes);
    length += bytes.length;
  };
  const write = (text: string) => push(latin1(text));
  const startObject = (n: number) => {
    offsets[n] = length;
    write(`${n} 0 obj\n`);
  };

  write("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n");

  startObject(1);
  write("<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");

  startObject(2);
  const kids = pages.map((_, i) => `${pageObjNum(i)} 0 R`).join(" ");
  write(`<< /Type /Pages /Kids [${kids}] /Count ${pageCount} >>\nendobj\n`);

  startObject(3);
  write("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>\nendobj\n");
  startObject(4);
  write("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>\nendobj\n");

  if (image) {
    startObject(imageObj);
    write(
      `<< /Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height}` +
        ` /ColorSpace /Device${image.components === 1 ? "Gray" : "RGB"} /BitsPerComponent 8` +
        ` /Filter /DCTDecode /Length ${image.bytes.length} >>\nstream\n`
    );
    push(image.bytes);
    write("\nendstream\nendobj\n");
  }

  const resources =
    `<< /Font << /F1 3 0 R /F2 4 0 R >>` +
    (image ? ` /XObject << /Im0 ${imageObj} 0 R >>` : "") +
    ` >>`;

  pages.forEach((ops, i) => {
    startObject(pageObjNum(i));
    write(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${num(doc.width)} ${num(doc.height)}]` +
        ` /Resources ${resources} /Contents ${contentObjNum(i)} 0 R >>\nendobj\n`
    );

    const stream = contentStream(ops, doc.height, image !== null);
    const streamBytes = latin1(stream);
    startObject(contentObjNum(i));
    write(`<< /Length ${streamBytes.length} >>\nstream\n`);
    push(streamBytes);
    write("endstream\nendobj\n");
  });

  const objectCount = contentObjNum(pages.length - 1) + 1;
  const xrefOffset = length;
  let xref = `xref\n0 ${objectCount}\n0000000000 65535 f \n`;
  for (let n = 1; n < objectCount; n++) {
    xref += `${String(offsets[n] ?? 0).padStart(10, "0")} 00000 n \n`;
  }
  write(xref);
  write(
    `trailer\n<< /Size ${objectCount} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`
  );

  const out = new Uint8Array(length);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}
