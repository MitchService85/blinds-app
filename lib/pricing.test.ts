import { describe, expect, it } from "vitest";
import {
  computeInvoice,
  countActualBlinds,
  countMotorizedBlinds,
  countRemoved,
  countTrips,
  emptyPricing,
  formatCents,
  parseDollarsToCents,
  type MoneyFloor,
} from "./pricing";
import type { ProjectPricing } from "./types";

const floor = (overrides: Partial<MoneyFloor> = {}): MoneyFloor => ({
  defaults: {},
  trips: null,
  units: [],
  ...overrides,
});

/** The Four Seasons shape: four zones, two quantity rows each, 98 blinds. */
function fourSeasons(): MoneyFloor[] {
  const side = (q1: number, q2: number, removed: number) => ({
    status: "active" as const,
    removed,
    windows: [
      { widths: [914], quantity: q1 },
      { widths: [920], quantity: q2 },
    ],
  });
  return [
    floor({
      trips: 1,
      units: [side(12, 24, 36), side(4, 9, 13), side(12, 24, 36), side(4, 9, 13)],
    }),
  ];
}

describe("counts", () => {
  it("counts blinds as panels x quantity, skipping N/A units", () => {
    const floors = [
      floor({
        units: [
          { status: "active", windows: [{ widths: [100, 200, 300] }] }, // 3-panel bay
          { status: "done", windows: [{ widths: [400], quantity: 13 }] }, // Cleveland L12
          { status: "na", windows: [{ widths: [500], quantity: 99 }] },
        ],
      }),
    ];
    expect(countActualBlinds(floors)).toBe(16);
  });

  it("matches the Four Seasons entry: 98 blinds, 98 removed", () => {
    expect(countActualBlinds(fourSeasons())).toBe(98);
    expect(countRemoved(fourSeasons())).toBe(98);
  });

  it("counts removal on N/A units too — the work already happened", () => {
    const floors = [
      floor({ units: [{ status: "na", removed: 5, windows: [] }] }),
    ];
    expect(countRemoved(floors)).toBe(5);
    expect(countActualBlinds(floors)).toBe(0);
  });

  it("resolves motorized from floor default with per-window override", () => {
    const floors = [
      floor({
        defaults: { motorized: true },
        units: [
          {
            status: "active",
            windows: [
              { widths: [100], quantity: 2 }, // inherits floor: motorized
              { widths: [100], motorized_override: false },
              { widths: [100, 100] }, // bay, inherits: 2 blinds
            ],
          },
        ],
      }),
      floor({
        units: [
          {
            status: "active",
            windows: [{ widths: [100], motorized_override: true }],
          },
        ],
      }),
    ];
    expect(countMotorizedBlinds(floors)).toBe(5);
  });

  it("sums trips across floors, treating null as zero", () => {
    expect(countTrips([floor({ trips: 2 }), floor({ trips: null }), floor({ trips: 1 })])).toBe(3);
  });
});

describe("computeInvoice", () => {
  const pricing = (overrides: Partial<ProjectPricing>): ProjectPricing => ({
    ...emptyPricing(),
    ...overrides,
  });

  it("bills contract + every extra with HST on the subtotal", () => {
    const invoice = computeInvoice(
      pricing({
        contract_cents: 1_000_000, // $10,000
        quoted_blind_count: 96,
        removal_per_blind_cents: 500, // $5 x 98 = $490
        install_per_blind_cents: 1_000, // $10 x 98 = $980
        trip_charge_cents: 7_500, // $75 x 1
      }),
      fourSeasons()
    );
    expect(invoice.lines.map((l) => l.key)).toEqual([
      "contract",
      "removal",
      "install",
      "trips",
    ]);
    expect(invoice.subtotal_cents).toBe(1_000_000 + 49_000 + 98_000 + 7_500);
    expect(invoice.hst_cents).toBe(Math.round(1_154_500 * 0.13));
    expect(invoice.total_cents).toBe(invoice.subtotal_cents + invoice.hst_cents);
    expect(invoice.actual_blinds).toBe(98);
    expect(invoice.variance).toBe(2); // measured 98 against Danny's 96
  });

  it("a null rate produces no line — e.g. install inside Danny's contract", () => {
    const invoice = computeInvoice(
      pricing({ contract_cents: 50_000, removal_per_blind_cents: null }),
      fourSeasons()
    );
    expect(invoice.lines).toHaveLength(1);
    expect(invoice.subtotal_cents).toBe(50_000);
  });

  it("a set rate with a zero count produces no line yet", () => {
    const invoice = computeInvoice(
      pricing({ trip_charge_cents: 7_500 }),
      [floor({ trips: null, units: [] })]
    );
    expect(invoice.lines).toHaveLength(0);
    expect(invoice.total_cents).toBe(0);
  });

  it("reports variance as null with no quoted count, negative when under", () => {
    expect(computeInvoice(pricing({}), fourSeasons()).variance).toBeNull();
    expect(
      computeInvoice(pricing({ quoted_blind_count: 100 }), fourSeasons()).variance
    ).toBe(-2);
  });

  it("rounds HST half-up at the one permitted rounding point", () => {
    // $1.19 subtotal -> HST 15.47 cents -> 15
    const invoice = computeInvoice(pricing({ contract_cents: 119 }), []);
    expect(invoice.hst_cents).toBe(15);
    expect(invoice.total_cents).toBe(134);
  });
});

describe("formatCents", () => {
  it("formats with grouping and two decimals", () => {
    expect(formatCents(0)).toBe("$0.00");
    expect(formatCents(123_456)).toBe("$1,234.56");
    expect(formatCents(500)).toBe("$5.00");
    expect(formatCents(-500)).toBe("-$5.00");
  });
});

describe("parseDollarsToCents", () => {
  it("accepts plain, grouped, and $-prefixed amounts", () => {
    expect(parseDollarsToCents("1250")).toBe(125_000);
    expect(parseDollarsToCents("$1,250.50")).toBe(125_050);
    expect(parseDollarsToCents("0.05")).toBe(5);
  });

  it("returns null (not zero) for blank or invalid input", () => {
    expect(parseDollarsToCents("")).toBeNull();
    expect(parseDollarsToCents("  ")).toBeNull();
    expect(parseDollarsToCents("12.345")).toBeNull();
    expect(parseDollarsToCents("abc")).toBeNull();
    expect(parseDollarsToCents("-5")).toBeNull();
  });
});
