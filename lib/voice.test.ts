import { describe, expect, it } from "vitest";

import { formatFraction } from "./fractions";
import { parseMeasurement, parseSpokenWindow } from "./voice";

const CHIPS = ["LR", "BR", "MBR", "Kit", "Studio", "Den", "Bath"];
const parse = (s: string) => parseSpokenWindow(s, CHIPS);
const inches = (sixteenths: number | undefined) =>
  sixteenths === undefined ? undefined : formatFraction(sixteenths);

describe("parseMeasurement", () => {
  it("reads the format iOS dictation produces", () => {
    expect(parseMeasurement("95 1/2")).toBe(1528);
    expect(inches(parseMeasurement("95 1/2")!)).toBe("95 1/2");
  });

  it("reads whole numbers and sixteenths", () => {
    expect(inches(parseMeasurement("87")!)).toBe("87");
    expect(inches(parseMeasurement("74 13/16")!)).toBe("74 13/16");
  });

  it("reads decimals that land exactly on a sixteenth", () => {
    expect(inches(parseMeasurement("95.5")!)).toBe("95 1/2");
  });

  it("refuses a value it cannot represent rather than rounding a guess", () => {
    expect(parseMeasurement("95.33")).toBeNull();
    expect(parseMeasurement("95 1/3")).toBeNull();
    expect(parseMeasurement("wide")).toBeNull();
  });
});

describe("parseSpokenWindow", () => {
  it("parses Mitch's example sentence", () => {
    const { fields, matched } = parse(
      "living room 1 95 1/2 wide by 87 tall. deduct both, longer chain"
    );
    expect(fields.tag_base).toBe("LR");
    expect(fields.tag_index).toBe(1);
    expect(inches(fields.widths![0])).toBe("95 1/2");
    expect(inches(fields.height)).toBe("87");
    expect(fields.deduct).toBe("D");
    expect(fields.longer_chain).toBe(true);
    expect(matched).toContain("width");
    expect(matched).toContain("height");
  });

  it("does not mistake the room index for a measurement", () => {
    const { fields } = parse("living room 2 70 by 87");
    expect(fields.tag_index).toBe(2);
    expect(inches(fields.widths![0])).toBe("70");
    expect(inches(fields.height)).toBe("87");
  });

  it("treats a lone number after the room as a width, not an index", () => {
    const { fields } = parse("bedroom 80 1/4 by 63");
    expect(fields.tag_base).toBe("BR");
    expect(fields.tag_index).toBe(0);
    expect(inches(fields.widths![0])).toBe("80 1/4");
  });

  it("handles a three-panel bay", () => {
    const { fields, matched } = parse(
      "living room 34 5/8, 53, 34 1/2 wide by 58 tall"
    );
    expect(fields.widths!.map(inches)).toEqual(["34 5/8", "53", "34 1/2"]);
    expect(inches(fields.height)).toBe("58");
    expect(matched).toContain("3 panel widths");
  });

  it("reads left control", () => {
    const { fields } = parse("living room 1 32 1/4 by 87 deduct left, left control");
    expect(fields.control_override).toBe("L");
    expect(fields.deduct).toBe("Dl");
  });

  it("reads a quantity without eating it as a measurement", () => {
    const { fields } = parse("43 1/8 by 83 times 13");
    expect(fields.quantity).toBe(13);
    expect(inches(fields.widths![0])).toBe("43 1/8");
    expect(inches(fields.height)).toBe("83");
  });

  it("respects wide/tall labels when spoken in reverse order", () => {
    const { fields } = parse("87 tall by 70 1/2 wide");
    expect(inches(fields.widths![0])).toBe("70 1/2");
    expect(inches(fields.height)).toBe("87");
  });

  it("understands master bedroom and spoken initialisms", () => {
    expect(parse("master bedroom 80 by 63").fields.tag_base).toBe("MBR");
    expect(parse("M B R 80 by 63").fields.tag_base).toBe("MBR");
    expect(parse("L R 70 by 87").fields.tag_base).toBe("LR");
  });

  it("understands spoken fractions", () => {
    expect(inches(parse("bedroom 80 and a half by 63").fields.widths![0])).toBe("80 1/2");
    expect(inches(parse("bedroom 80 and three quarters by 63").fields.widths![0])).toBe(
      "80 3/4"
    );
  });

  it("leaves height blank when only one measurement was heard", () => {
    const { fields } = parse("living room 70 1/2 wide");
    expect(inches(fields.widths![0])).toBe("70 1/2");
    expect(fields.height).toBeUndefined();
  });

  it("returns nothing rather than guessing on an unusable sentence", () => {
    const { fields, matched } = parse("uh what was that again");
    expect(fields.widths).toBeUndefined();
    expect(fields.height).toBeUndefined();
    expect(matched).toEqual([]);
  });

  it("matches a project's own chip ahead of the built-in room words", () => {
    const { fields } = parseSpokenWindow("B R 2 70 by 87", [...CHIPS, "BR2"]);
    expect(fields.tag_base).toBe("BR2");
  });

  it("reports leftover words so a misheard phrase is visible", () => {
    const { leftover } = parse("living room 70 by 87 with the thingy");
    expect(leftover).toContain("thingy");
  });
});
