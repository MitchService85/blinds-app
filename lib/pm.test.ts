import { describe, expect, it } from "vitest";
import { pmProgress, pmShareUrl, pmWindowLabels } from "./pm";

describe("pmWindowLabels", () => {
  it("numbers repeated tags the way the unit screen does", () => {
    const labels = pmWindowLabels({
      windows: [
        { id: "a", tag_base: "LR", sort_order: 0 },
        { id: "b", tag_base: "LR", sort_order: 1 },
        { id: "c", tag_base: "BR", sort_order: 2 },
      ],
    });
    expect(labels.get("a")).toBe("LR1");
    expect(labels.get("b")).toBe("LR2");
    expect(labels.get("c")).toBe("BR");
  });

  it("numbers untagged zone-run windows by position", () => {
    const labels = pmWindowLabels({
      windows: [
        { id: "a", tag_base: "", sort_order: 0 },
        { id: "b", tag_base: "", sort_order: 1 },
      ],
    });
    expect(labels.get("a")).toBe("#1");
    expect(labels.get("b")).toBe("#2");
  });
});

describe("pmProgress", () => {
  it("counts done over total", () => {
    expect(pmProgress([{ done: true }, { done: false }, { done: true }])).toEqual({ done: 2, total: 3 });
    expect(pmProgress([])).toEqual({ done: 0, total: 0 });
  });
});

describe("pmShareUrl", () => {
  it("builds an absolute link and tolerates a trailing slash on the origin", () => {
    expect(pmShareUrl("abc", "https://measure.example/")).toBe("https://measure.example/pm/abc");
    expect(pmShareUrl("abc", "https://measure.example")).toBe("https://measure.example/pm/abc");
  });
});
