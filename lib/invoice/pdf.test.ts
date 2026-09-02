import { describe, expect, it } from "vitest";
import { imageFromDataUrl, measureText, parseJpeg, renderPdf, wrapText } from "./pdf";
import type { PdfDoc } from "./pdf";

const latin1 = (bytes: Uint8Array) => String.fromCharCode(...bytes);

const doc = (over: Partial<PdfDoc> = {}): PdfDoc => ({
  width: 612,
  height: 792,
  pages: [[{ op: "text", x: 54, y: 54, size: 10, font: "regular", text: "Hello" }]],
  ...over,
});

/**
 * The xref table is the one part of a PDF a reader trusts absolutely: every
 * entry must be the exact byte offset of "N 0 obj". Getting this wrong is how
 * a file opens fine in one viewer and is blank in another, so it is checked
 * structurally rather than by eyeballing a render.
 */
function assertXrefIsSound(bytes: Uint8Array) {
  const text = latin1(bytes);
  const startxref = /startxref\s+(\d+)/.exec(text);
  expect(startxref).not.toBeNull();
  const xrefStart = parseInt(startxref![1], 10);
  expect(text.slice(xrefStart, xrefStart + 4)).toBe("xref");

  const header = /xref\n0 (\d+)\n/.exec(text.slice(xrefStart));
  expect(header).not.toBeNull();
  const count = parseInt(header![1], 10);
  // Every entry is exactly 20 bytes, and entry 0 is the free-list head.
  const entriesAt = xrefStart + header![0].length;
  for (let n = 1; n < count; n++) {
    const entry = text.slice(entriesAt + n * 20, entriesAt + (n + 1) * 20);
    const offset = parseInt(entry.slice(0, 10), 10);
    expect(text.slice(offset, offset + `${n} 0 obj`.length)).toBe(`${n} 0 obj`);
  }
  return count;
}

describe("renderPdf", () => {
  it("writes a well-formed file with a sound xref table", () => {
    const bytes = renderPdf(doc());
    const text = latin1(bytes);
    expect(text.startsWith("%PDF-1.4")).toBe(true);
    expect(text.trimEnd().endsWith("%%EOF")).toBe(true);
    assertXrefIsSound(bytes);
  });

  it("keeps offsets sound across multiple pages", () => {
    const bytes = renderPdf(
      doc({
        pages: [
          [{ op: "text", x: 10, y: 10, size: 10, font: "regular", text: "one" }],
          [{ op: "text", x: 10, y: 10, size: 10, font: "bold", text: "two" }],
          [{ op: "line", x1: 0, y1: 0, x2: 10, y2: 10 }],
        ],
      })
    );
    const text = latin1(bytes);
    expect(text).toContain("/Count 3");
    // 4 fixed objects + 2 per page.
    expect(assertXrefIsSound(bytes)).toBe(11);
  });

  it("escapes the characters that would otherwise end a PDF string", () => {
    const bytes = renderPdf(
      doc({ pages: [[{ op: "text", x: 0, y: 0, size: 10, font: "regular", text: "A (b) c\\d" }]] })
    );
    expect(latin1(bytes)).toContain("(A \\(b\\) c\\\\d)");
  });

  it("maps curly quotes and dashes into WinAnsi instead of dropping them", () => {
    const RSQUO = "’";
    const EMDASH = "—";
    const bytes = renderPdf(
      doc({
        pages: [
          [{ op: "text", x: 0, y: 0, size: 10, font: "regular", text: `it${RSQUO}s ${EMDASH} ok` }],
        ],
      })
    );
    const expected = `(it${String.fromCharCode(0x92)}s ${String.fromCharCode(0x97)} ok)`;
    expect(latin1(bytes)).toContain(expected);
  });

  it("substitutes an unrepresentable character rather than emitting a bad byte", () => {
    const bytes = renderPdf(
      doc({ pages: [[{ op: "text", x: 0, y: 0, size: 10, font: "regular", text: "ok 中" }]] })
    );
    expect(latin1(bytes)).toContain("(ok ?)");
    for (const b of bytes) expect(b).toBeLessThanOrEqual(255);
  });

  it("flips top-left layout coordinates to PDF's bottom-left origin", () => {
    const bytes = renderPdf(
      doc({ pages: [[{ op: "text", x: 54, y: 100, size: 10, font: "regular", text: "x" }]] })
    );
    // 792 - 100
    expect(latin1(bytes)).toContain("1 0 0 1 54 692 Tm");
  });

  it("right-aligns by measured width", () => {
    const bytes = renderPdf(
      doc({
        pages: [
          [{ op: "text", x: 558, y: 100, size: 10, font: "regular", text: "$1,200.00", align: "right" }],
        ],
      })
    );
    const width = measureText("$1,200.00", 10, "regular");
    expect(latin1(bytes)).toContain(`1 0 0 1 ${Math.round((558 - width) * 100) / 100} 692 Tm`);
  });

  it("declares no XObject resource when there is no image", () => {
    expect(latin1(renderPdf(doc()))).not.toContain("/XObject");
  });
});

describe("measureText", () => {
  it("scales with point size", () => {
    expect(measureText("Hello", 20, "regular")).toBeCloseTo(measureText("Hello", 10, "regular") * 2);
  });

  it("makes bold wider than regular for the same string", () => {
    expect(measureText("Total due", 10, "bold")).toBeGreaterThan(
      measureText("Total due", 10, "regular")
    );
  });

  it("gives digits a uniform advance, which is what lets money columns line up", () => {
    expect(measureText("1111111111", 10, "regular")).toBeCloseTo(
      measureText("9080706050", 10, "regular")
    );
  });
});

describe("wrapText", () => {
  it("breaks on width and preserves explicit newlines", () => {
    const lines = wrapText("Elite Window Coverings\nAttn: Accounts Payable", 10, "regular", 90);
    expect(lines[0]).toBe("Elite Window");
    expect(lines).toContain("Attn: Accounts");
  });

  it("never drops a word too long to fit", () => {
    const lines = wrapText("supercalifragilistic", 10, "regular", 20);
    expect(lines).toEqual(["supercalifragilistic"]);
  });
});

describe("parseJpeg", () => {
  /** A minimal SOF header — enough for the parser, not a decodable image. */
  function fakeJpeg(width: number, height: number, components: number, marker = 0xc0) {
    const bytes = [0xff, 0xd8];
    // An APP0 segment first, so the marker walk has to skip a length payload.
    bytes.push(0xff, 0xe0, 0x00, 0x04, 0x00, 0x00);
    bytes.push(0xff, marker, 0x00, 0x11, 0x08);
    bytes.push((height >> 8) & 255, height & 255, (width >> 8) & 255, width & 255, components);
    return new Uint8Array(bytes);
  }

  it("reads dimensions past a leading segment", () => {
    expect(parseJpeg(fakeJpeg(640, 480, 3))).toMatchObject({
      width: 640,
      height: 480,
      components: 3,
    });
  });

  it("accepts progressive JPEGs, which DCTDecode also handles", () => {
    expect(parseJpeg(fakeJpeg(100, 50, 3, 0xc2))).toMatchObject({ width: 100, components: 3 });
  });

  it("refuses what it cannot describe rather than emitting a broken XObject", () => {
    expect(parseJpeg(fakeJpeg(10, 10, 4))).toBeNull(); // CMYK
    expect(parseJpeg(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBeNull(); // PNG
    expect(parseJpeg(new Uint8Array([]))).toBeNull();
  });

  it("reads a data URL and shrugs off anything that isn't one", () => {
    const base64 = btoa(String.fromCharCode(...fakeJpeg(32, 16, 1)));
    expect(imageFromDataUrl(`data:image/jpeg;base64,${base64}`)).toMatchObject({
      width: 32,
      components: 1,
    });
    expect(imageFromDataUrl("data:image/png;base64,AAAA")).toBeNull();
    expect(imageFromDataUrl("")).toBeNull();
  });
});
