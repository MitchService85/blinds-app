import { describe, expect, it } from "vitest";
import { formatTripDate, todayLocalDate } from "@/components/trip-log";

describe("formatTripDate", () => {
  // `new Date("2026-09-08")` parses as UTC midnight, which in Toronto is the
  // evening of the 7th — a trip logged on the 8th would read "Sep 7" on the
  // invoice. Parsing the parts and building a local date is what avoids it.
  it("shows the date that was logged, not the day before", () => {
    expect(formatTripDate("2026-09-08")).toBe("Tue, Sep 8");
    expect(formatTripDate("2026-01-01")).toBe("Thu, Jan 1");
  });

  it("passes anything unparseable straight through", () => {
    expect(formatTripDate("")).toBe("");
    expect(formatTripDate("not a date")).toBe("not a date");
  });
});

describe("todayLocalDate", () => {
  // toISOString() is UTC, which rolls over at 8pm in Toronto (UTC-4). A trip
  // logged after supper must still be dated today, not tomorrow.
  it("gives the local calendar date, not the UTC one", () => {
    const realOffset = Date.prototype.getTimezoneOffset;
    // Toronto in September: UTC-4, so getTimezoneOffset() is +240 minutes.
    Date.prototype.getTimezoneOffset = () => 240;
    try {
      // 2026-09-08 21:30 Toronto === 2026-09-09 01:30 UTC.
      expect(todayLocalDate(new Date("2026-09-09T01:30:00Z"))).toBe("2026-09-08");
      // And a morning reading is unaffected.
      expect(todayLocalDate(new Date("2026-09-08T14:00:00Z"))).toBe("2026-09-08");
    } finally {
      Date.prototype.getTimezoneOffset = realOffset;
    }
  });
});
