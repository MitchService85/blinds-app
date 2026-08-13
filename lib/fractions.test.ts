import { describe, expect, it } from "vitest";
import { floorToEighth, formatFraction, toDecimal, toSixteenths } from "./fractions";

describe("toSixteenths", () => {
  it("converts a whole number with no fraction", () => {
    expect(toSixteenths(74, 0, 16)).toBe(1184);
  });

  it("converts eighths", () => {
    expect(toSixteenths(74, 7, 8)).toBe(1198); // 74 7/8
  });

  it("converts sixteenths (laser reading)", () => {
    expect(toSixteenths(74, 13, 16)).toBe(1197); // 74 13/16
  });

  it("converts halves and quarters", () => {
    expect(toSixteenths(10, 1, 2)).toBe(168); // 10 1/2
    expect(toSixteenths(10, 1, 4)).toBe(164); // 10 1/4
  });

  it("throws on a denominator that does not evenly divide 16", () => {
    expect(() => toSixteenths(1, 1, 3)).toThrow();
  });
});

describe("floorToEighth", () => {
  it("rounds a sixteenths reading down to the nearest eighth", () => {
    // 74 13/16 -> 74 3/4
    expect(floorToEighth(1197)).toBe(1196);
  });

  it("leaves an already-eighth value unchanged", () => {
    // 74 3/4 stays 74 3/4
    expect(floorToEighth(1196)).toBe(1196);
  });

  it("rounds down other odd sixteenths", () => {
    // 12 1/16 -> 12
    expect(floorToEighth(193)).toBe(192);
    // 12 15/16 -> 12 7/8
    expect(floorToEighth(207)).toBe(206);
  });

  it("handles zero", () => {
    expect(floorToEighth(0)).toBe(0);
  });
});

describe("formatFraction", () => {
  it("formats a whole number with no fraction", () => {
    expect(formatFraction(1184)).toBe("74");
  });

  it("formats and reduces eighths", () => {
    expect(formatFraction(1198)).toBe("74 7/8");
  });

  it("reduces 4/8 down to 1/2", () => {
    // 74 4/8 (1192 sixteenths) should print as 74 1/2
    expect(formatFraction(1192)).toBe("74 1/2");
  });

  it("reduces 8/16 down to 1/2", () => {
    expect(formatFraction(1192)).toBe("74 1/2");
  });

  it("keeps an unreduced sixteenth as-is", () => {
    expect(formatFraction(1197)).toBe("74 13/16");
  });

  it("formats a pure fraction under one inch", () => {
    expect(formatFraction(7)).toBe("7/16");
  });

  it("formats zero", () => {
    expect(formatFraction(0)).toBe("0");
  });
});

describe("toDecimal", () => {
  it("converts sixteenths to decimal inches", () => {
    expect(toDecimal(1198)).toBeCloseTo(74.875);
    expect(toDecimal(1184)).toBe(74);
    expect(toDecimal(0)).toBe(0);
  });
});
