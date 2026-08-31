// Job money math (see docs/superpowers/plans/2026-08-21-job-money-plan.md).
//
// Pure functions over plain, already-loaded shapes — same pattern as
// lib/export/shared.ts, and for the same reason: the project screen wants to
// recompute the invoice on every data refresh without touching Dexie or
// ExcelJS. All money is integer cents; only formatting produces strings.
import { effectiveMotorized } from "./export/shared";
import type { FloorDefaults, ProjectPricing, UnitStatus } from "./types";

/** Ontario HST, applied on the invoice subtotal. */
export const HST_RATE = 0.13;

/** A window as the money math needs it — a narrow slice of WindowRecord. */
export interface MoneyWindow {
  /** Panel widths; each panel is a blind. */
  widths: number[];
  quantity?: number;
  motorized_override?: boolean | null;
}

export interface MoneyUnit {
  status: UnitStatus;
  removed?: number;
  windows: MoneyWindow[];
}

export interface MoneyFloor {
  defaults: Pick<FloorDefaults, "motorized">;
  trips: number | null;
  units: MoneyUnit[];
}

/** One blind per panel, times the quantity — the countBlinds definition
 * (Cleveland L12: 1 opening, 13 blinds). N/A units don't count: they were
 * never measured, so they hold no blinds. */
function unitBlinds(unit: MoneyUnit): number {
  if (unit.status === "na") return 0;
  return unit.windows.reduce((sum, w) => sum + w.widths.length * (w.quantity ?? 1), 0);
}

export function countActualBlinds(floors: MoneyFloor[]): number {
  return floors.reduce(
    (sum, f) => sum + f.units.reduce((s, u) => s + unitBlinds(u), 0),
    0
  );
}

export function countMotorizedBlinds(floors: MoneyFloor[]): number {
  let total = 0;
  for (const floor of floors) {
    for (const unit of floor.units) {
      if (unit.status === "na") continue;
      for (const w of unit.windows) {
        if (effectiveMotorized(floor.defaults, w.motorized_override)) {
          total += w.widths.length * (w.quantity ?? 1);
        }
      }
    }
  }
  return total;
}

/** Removal is physical work already done, so it counts on every unit —
 * including ones later marked N/A for measuring. */
export function countRemoved(floors: MoneyFloor[]): number {
  return floors.reduce(
    (sum, f) => sum + f.units.reduce((s, u) => s + (u.removed ?? 0), 0),
    0
  );
}

export function countTrips(floors: MoneyFloor[]): number {
  return floors.reduce((sum, f) => sum + (f.trips ?? 0), 0);
}

export interface InvoiceLine {
  key: "contract" | "removal" | "install" | "motorized" | "trips";
  label: string;
  /** Count the rate applies to; null for the contract lump sum. */
  qty: number | null;
  /** Rate in cents; null for the contract lump sum. */
  unit_cents: number | null;
  amount_cents: number;
}

export interface Invoice {
  lines: InvoiceLine[];
  subtotal_cents: number;
  hst_cents: number;
  total_cents: number;
  /** Blinds actually measured, for the variance badge. */
  actual_blinds: number;
  /** actual − quoted; null when no quoted count is recorded. */
  variance: number | null;
}

/**
 * Assemble the invoice: contract plus each extra whose rate is set. A rate of
 * null means "not billed on this job" and produces no line; a rate that IS
 * set still produces no line while its count is zero (nothing to bill yet).
 */
export function computeInvoice(pricing: ProjectPricing, floors: MoneyFloor[]): Invoice {
  const actual = countActualBlinds(floors);
  const lines: InvoiceLine[] = [];

  if (pricing.contract_cents !== null) {
    lines.push({
      key: "contract",
      label: "Contract",
      qty: null,
      unit_cents: null,
      amount_cents: pricing.contract_cents,
    });
  }

  const addRateLine = (
    key: InvoiceLine["key"],
    label: string,
    qty: number,
    rate: number | null
  ) => {
    if (rate === null || qty === 0) return;
    lines.push({ key, label, qty, unit_cents: rate, amount_cents: qty * rate });
  };

  addRateLine("removal", "Removal of old blinds", countRemoved(floors), pricing.removal_per_blind_cents);
  addRateLine("install", "Install labor", actual, pricing.install_per_blind_cents);
  addRateLine("motorized", "Motorized premium", countMotorizedBlinds(floors), pricing.motorized_premium_cents);
  addRateLine("trips", "Trip charges", countTrips(floors), pricing.trip_charge_cents);

  const subtotal = lines.reduce((sum, l) => sum + l.amount_cents, 0);
  // Cents are integers everywhere except this one rounding, at the HST line.
  const hst = Math.round(subtotal * HST_RATE);

  return {
    lines,
    subtotal_cents: subtotal,
    hst_cents: hst,
    total_cents: subtotal + hst,
    actual_blinds: actual,
    variance:
      pricing.quoted_blind_count === null ? null : actual - pricing.quoted_blind_count,
  };
}

/** "$1,234.56". Negative amounts keep the sign ahead of the $: "-$5.00". */
export function formatCents(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100).toLocaleString("en-CA");
  return `${sign}$${dollars}.${String(abs % 100).padStart(2, "0")}`;
}

/**
 * Parse a dollar amount typed on the pricing form into cents. Accepts "1250",
 * "1,250.5", "$1250.00". Returns null for blank/invalid input — which the
 * form treats as "rate not set", never as zero.
 */
export function parseDollarsToCents(input: string): number | null {
  const cleaned = input.replace(/[$,\s]/g, "");
  if (!cleaned) return null;
  if (!/^\d+(\.\d{0,2})?$/.test(cleaned)) return null;
  return Math.round(parseFloat(cleaned) * 100);
}

/** An all-null pricing record, for "Set up pricing" on a project. */
export function emptyPricing(): ProjectPricing {
  return {
    contract_cents: null,
    quoted_blind_count: null,
    removal_per_blind_cents: null,
    install_per_blind_cents: null,
    motorized_premium_cents: null,
    trip_charge_cents: null,
    note: "",
  };
}
