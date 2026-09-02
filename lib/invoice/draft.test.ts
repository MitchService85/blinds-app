import { describe, expect, it } from "vitest";
import {
  addDays,
  buildDraft,
  dueDateFrom,
  duplicateNumbers,
  emptyBilling,
  formatInvoiceDate,
  issuerFromCompany,
  linesFromComputed,
  makeLineItem,
  nextInvoiceNumber,
  recalcLine,
  todayISODate,
  totalsFor,
} from "./draft";
import { computeInvoice } from "../pricing";
import type { Company, InvoiceLineItem } from "../types";

const company = (over: Partial<Company> = {}): Pick<Company, "name" | "logo" | "billing"> => ({
  name: "Keep It Shady",
  logo: "",
  billing: { ...emptyBilling(), invoice_prefix: "KIS" },
  ...over,
});

describe("nextInvoiceNumber", () => {
  it("starts the series at 0001", () => {
    expect(nextInvoiceNumber("KIS", [])).toBe("KIS-0001");
    expect(nextInvoiceNumber("", [])).toBe("0001");
  });

  it("continues from the highest number, not the count", () => {
    expect(nextInvoiceNumber("KIS", ["KIS-0001", "KIS-0009", "KIS-0004"])).toBe("KIS-0010");
  });

  it("ignores numbers from a different prefix", () => {
    // Switching prefix starts a fresh run rather than inheriting the old one.
    expect(nextInvoiceNumber("SHADY", ["KIS-0042"])).toBe("SHADY-0001");
    // ...and a hand-typed one-off never bumps the counter.
    expect(nextInvoiceNumber("KIS", ["KIS-0003", "CREDIT-99"])).toBe("KIS-0004");
  });

  it("keeps counting past four digits", () => {
    expect(nextInvoiceNumber("KIS", ["KIS-9999"])).toBe("KIS-10000");
  });
});

describe("dates", () => {
  it("dates an invoice by the local day, not UTC", () => {
    // 9pm in Toronto is already tomorrow in UTC. The invoice is dated today.
    const evening = new Date(2026, 8, 2, 21, 30);
    expect(todayISODate(evening)).toBe("2026-09-02");
  });

  it("adds days across a month boundary and a DST change", () => {
    expect(addDays("2026-08-30", 3)).toBe("2026-09-02");
    // Toronto leaves DST on 2026-11-01; a naive local-midnight add loses a day.
    expect(addDays("2026-10-30", 3)).toBe("2026-11-02");
  });

  it("reads Net terms and leaves anything else blank", () => {
    expect(dueDateFrom("2026-09-02", "Net 30")).toBe("2026-10-02");
    expect(dueDateFrom("2026-09-02", "net15")).toBe("2026-09-17");
    expect(dueDateFrom("2026-09-02", "Due on receipt")).toBe("");
  });

  it("formats a stored date as the same calendar day", () => {
    expect(formatInvoiceDate("2026-09-02")).toBe("Sep 2, 2026");
  });
});

describe("issuerFromCompany", () => {
  it("prefers the legal name and falls back to the trading name", () => {
    expect(issuerFromCompany(company()).name).toBe("Keep It Shady");
    const legal = company({
      billing: { ...emptyBilling(), legal_name: "1234567 Ontario Inc." },
    });
    expect(issuerFromCompany(legal).name).toBe("1234567 Ontario Inc.");
  });

  it("survives a company that has never filled billing in", () => {
    const issuer = issuerFromCompany({ name: "Shady", logo: "", billing: null });
    expect(issuer.name).toBe("Shady");
    expect(issuer.hst_number).toBe("");
  });
});

describe("line math", () => {
  it("recomputes a metered line and leaves a lump sum alone", () => {
    const metered = makeLineItem("Install", 7, 4000, 0);
    expect(recalcLine(metered).amount_cents).toBe(28000);

    const lump = makeLineItem("Contract", null, null, 1_200_000);
    expect(recalcLine(lump).amount_cents).toBe(1_200_000);
  });

  it("taxes the subtotal, rounding only at the tax line", () => {
    const lines: InvoiceLineItem[] = [
      makeLineItem("Contract", null, null, 1_200_000),
      makeLineItem("Install", 7, 4000, 28_000),
    ];
    const totals = totalsFor(lines, 0.13);
    expect(totals.subtotal_cents).toBe(1_228_000);
    expect(totals.hst_cents).toBe(159_640);
    expect(totals.total_cents).toBe(1_387_640);
  });

  it("keeps cents integral when the tax lands on a half cent", () => {
    const totals = totalsFor([makeLineItem("Odd", null, null, 1_000_050)], 0.13);
    expect(Number.isInteger(totals.hst_cents)).toBe(true);
    expect(totals.total_cents).toBe(totals.subtotal_cents + totals.hst_cents);
  });
});

describe("buildDraft", () => {
  const floors = [
    {
      defaults: { motorized: false },
      trips: 2,
      units: [
        { status: "done" as const, removed: 3, windows: [{ widths: [40, 50] }] },
        { status: "active" as const, removed: 0, windows: [{ widths: [60] }] },
      ],
    },
  ];
  const pricing = {
    contract_cents: 1_200_000,
    quoted_blind_count: 3,
    removal_per_blind_cents: 1500,
    install_per_blind_cents: 4000,
    motorized_premium_cents: null,
    trip_charge_cents: null,
    note: "",
  };

  it("carries the computed job lines onto the draft", () => {
    const computed = computeInvoice(pricing, floors);
    const draft = buildDraft({
      projectId: "p1",
      lines: linesFromComputed(computed),
      company: company(),
      existingNumbers: ["KIS-0006"],
      now: new Date(2026, 8, 2, 10, 0),
    });

    expect(draft.number).toBe("KIS-0007");
    expect(draft.issue_date).toBe("2026-09-02");
    expect(draft.due_date).toBe("2026-10-02");
    expect(draft.status).toBe("draft");
    expect(draft.lines.map((l) => l.label)).toEqual([
      "Contract",
      "Removal of old blinds",
      "Install labor",
    ]);
    // The stored totals agree with the stored lines, which is the whole point
    // of an invoice being a snapshot rather than a view.
    expect(draft.subtotal_cents).toBe(draft.lines.reduce((s, l) => s + l.amount_cents, 0));
    expect(draft.total_cents).toBe(draft.subtotal_cents + draft.hst_cents);
    expect(draft.hst_rate).toBe(0.13);
  });

  it("prefills the bill-to and payment blocks from company billing", () => {
    const draft = buildDraft({
      projectId: "p1",
      lines: [],
      company: company({
        billing: {
          ...emptyBilling(),
          invoice_prefix: "KIS",
          default_bill_to: "Elite Window Coverings\nAttn: AP",
          payment_instructions: "e-transfer",
        },
      }),
      existingNumbers: [],
    });
    expect(draft.bill_to).toContain("Elite");
    expect(draft.payment_instructions).toBe("e-transfer");
  });

  it("gives each line its own id so editing one never touches another", () => {
    const draft = buildDraft({
      projectId: "p1",
      lines: linesFromComputed(computeInvoice(pricing, floors)),
      company: company(),
      existingNumbers: [],
    });
    expect(new Set(draft.lines.map((l) => l.id)).size).toBe(draft.lines.length);
  });
});

describe("duplicateNumbers", () => {
  it("flags a repeat regardless of case or padding whitespace", () => {
    const dupes = duplicateNumbers([
      { number: "KIS-0001" },
      { number: " kis-0001 " },
      { number: "KIS-0002" },
      { number: "" },
      { number: "" },
    ]);
    expect(dupes.has("kis-0001")).toBe(true);
    expect(dupes.has("kis-0002")).toBe(false);
    // A pair of blanks is not a numbering clash; it is two unfinished drafts.
    expect(dupes.has("")).toBe(false);
  });
});
