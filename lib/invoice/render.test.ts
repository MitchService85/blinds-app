import { describe, expect, it } from "vitest";
import { buildInvoicePdf, invoicePdfBytes, parseHexColor, suggestedInvoiceFilename } from "./render";
import { makeLineItem } from "./draft";
import type { InvoiceRecord } from "../types";

const invoice = (over: Partial<InvoiceRecord> = {}): InvoiceRecord => ({
  id: "i1",
  updated_at: "2026-09-02T10:00:00.000Z",
  deleted: false,
  project_id: "p1",
  number: "KIS-0007",
  issue_date: "2026-09-02",
  due_date: "2026-10-02",
  status: "sent",
  sent_at: "2026-09-02T10:00:00.000Z",
  paid_at: null,
  bill_to: "Elite Window Coverings\nAttn: Accounts Payable",
  po_number: "ORD-4471",
  terms: "Net 30",
  lines: [
    makeLineItem("Contract", null, null, 1_200_000),
    makeLineItem("Install labor", 7, 4000, 28_000),
  ],
  hst_rate: 0.13,
  subtotal_cents: 1_228_000,
  hst_cents: 159_640,
  total_cents: 1_387_640,
  note: "Level 3 only.",
  payment_instructions: "e-transfer to ap@example.com",
  issuer: {
    name: "Keep It Shady",
    address: "1 Example Rd\nToronto, ON",
    email: "hi@example.com",
    phone: "416-555-0100",
    hst_number: "12345 6789 RT0001",
    logo: "",
  },
  ...over,
});

const textOf = (bytes: Uint8Array) => String.fromCharCode(...bytes);

const input = (over: Partial<InvoiceRecord> = {}) => ({
  invoice: invoice(over),
  projectName: "Arbour",
  projectAddress: "100 Somewhere Ave",
});

describe("buildInvoicePdf", () => {
  it("prints everything an accounts-payable clerk needs to pay it", () => {
    const text = textOf(invoicePdfBytes(input()));
    for (const expected of [
      "KIS-0007",
      "Sep 2, 2026",
      "Oct 2, 2026",
      "Net 30",
      "ORD-4471",
      "Elite Window Coverings",
      "Keep It Shady",
      // The registration number without which the tax cannot be claimed back.
      "HST/GST #: 12345 6789 RT0001",
      "e-transfer to ap@example.com",
      "Level 3 only.",
    ]) {
      expect(text).toContain(expected);
    }
  });

  it("prints the stored totals, never a recomputation", () => {
    // Deliberately inconsistent: the lines say $12,280 and the stored total
    // says $1.00. An invoice is a snapshot, so the snapshot is what prints.
    const text = textOf(
      invoicePdfBytes(input({ subtotal_cents: 100, hst_cents: 13, total_cents: 113 }))
    );
    expect(text).toContain("$1.13");
    expect(text).not.toContain("$13,876.40");
  });

  it("shows a metered line's qty and rate and a lump sum's neither", () => {
    const text = textOf(invoicePdfBytes(input()));
    expect(text).toContain("(7)");
    expect(text).toContain("($40.00)");
    expect(text).toContain("($12,000.00)");
  });

  it("labels the tax line with the invoice's own stored rate", () => {
    expect(textOf(invoicePdfBytes(input()))).toContain("HST 13%");
    expect(textOf(invoicePdfBytes(input({ hst_rate: 0.05 })))).toContain("HST 5%");
  });

  it("omits a due date rather than printing a blank one", () => {
    const text = textOf(invoicePdfBytes(input({ due_date: "" })));
    expect(text).not.toContain("(Due)");
  });

  it("fits on one page for a normal job and paginates a long one", () => {
    expect(buildInvoicePdf(input()).pages).toHaveLength(1);

    const many = Array.from({ length: 60 }, (_, i) =>
      makeLineItem(`Suite ${i + 100} — supply and install`, 3, 4000, 12_000)
    );
    const long = buildInvoicePdf(input({ lines: many }));
    expect(long.pages.length).toBeGreaterThan(1);
    // Multi-page invoices number their pages so they can be reassembled.
    const text = textOf(invoicePdfBytes(input({ lines: many })));
    expect(text).toContain(`page 1 of ${long.pages.length}`);
  });

  it("carries a JPEG logo into the file and skips one it cannot read", () => {
    const jpeg = new Uint8Array([
      0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x40, 0x00, 0x80, 0x03,
    ]);
    const dataUrl = `data:image/jpeg;base64,${btoa(String.fromCharCode(...jpeg))}`;
    const withLogo = buildInvoicePdf(
      input({ issuer: { ...invoice().issuer, logo: dataUrl } })
    );
    expect(withLogo.image).not.toBeNull();
    // 128 x 64 scaled into the 150 x 44 box: height-limited, aspect kept.
    const imageOp = withLogo.pages[0].find((op) => op.op === "image");
    expect(imageOp).toMatchObject({ w: 88, h: 44 });

    const broken = buildInvoicePdf(
      input({ issuer: { ...invoice().issuer, logo: "data:image/png;base64,AAAA" } })
    );
    expect(broken.image).toBeNull();
    expect(broken.pages[0].some((op) => op.op === "image")).toBe(false);
  });

  it("survives an invoice with nothing filled in", () => {
    const bare = invoicePdfBytes({
      invoice: invoice({
        number: "",
        bill_to: "",
        po_number: "",
        terms: "",
        due_date: "",
        note: "",
        payment_instructions: "",
        lines: [],
        subtotal_cents: 0,
        hst_cents: 0,
        total_cents: 0,
      }),
      projectName: "",
      projectAddress: "",
    });
    expect(String.fromCharCode(...bare).startsWith("%PDF")).toBe(true);
  });
});

describe("suggestedInvoiceFilename", () => {
  it("names the file after the invoice and strips path characters", () => {
    expect(suggestedInvoiceFilename({ number: "KIS-0007" })).toBe("Invoice KIS-0007.pdf");
    expect(suggestedInvoiceFilename({ number: "A/B 2" })).toBe("Invoice A-B-2.pdf");
    expect(suggestedInvoiceFilename({ number: "" })).toBe("Invoice invoice.pdf");
  });
});

describe("parseHexColor", () => {
  it("reads a hex colour and falls back on anything else", () => {
    expect(parseHexColor("#FFFFFF")).toEqual([1, 1, 1]);
    expect(parseHexColor("000000")).toEqual([0, 0, 0]);
    expect(parseHexColor("")).toEqual(parseHexColor("not a colour"));
  });
});
