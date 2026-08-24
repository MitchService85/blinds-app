import { describe, expect, it } from "vitest";
import { localDateISO } from "./build-input";

describe("localDateISO", () => {
  it("uses the device's own calendar date, not UTC", () => {
    // 9pm Toronto on the 15th is 1am UTC on the 16th. toISOString() says 16;
    // the workbook must say 15.
    const ninePmToronto = new Date("2026-08-16T01:00:00Z");
    const local = localDateISO(ninePmToronto);
    expect(local).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(local).toBe(
      `${ninePmToronto.getFullYear()}-${String(ninePmToronto.getMonth() + 1).padStart(2, "0")}-${String(ninePmToronto.getDate()).padStart(2, "0")}`
    );
  });
});
