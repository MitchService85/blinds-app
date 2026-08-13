import { describe, expect, it } from "vitest";
import { computeTagLabels } from "./tags";

function win(id: string, tag_base: string, sort_order: number, deleted = false) {
  return { id, tag_base, sort_order, deleted };
}

describe("computeTagLabels", () => {
  it("gives a lone window the plain tag, ignoring tag_index", () => {
    const labels = computeTagLabels([win("w1", "LR", 0)]);
    expect(labels.get("w1")).toBe("LR");
  });

  it("numbers two+ windows of the same tag_base by sort_order", () => {
    const labels = computeTagLabels([win("w1", "LR", 0), win("w2", "LR", 1)]);
    expect(labels.get("w1")).toBe("LR1");
    expect(labels.get("w2")).toBe("LR2");
  });

  it("retro-numbers a previously-lone window when a second is added", () => {
    // Start with just one LR.
    let labels = computeTagLabels([win("w1", "LR", 0)]);
    expect(labels.get("w1")).toBe("LR");

    // Add a second LR — the first should now become LR1.
    labels = computeTagLabels([win("w1", "LR", 0), win("w2", "LR", 1)]);
    expect(labels.get("w1")).toBe("LR1");
    expect(labels.get("w2")).toBe("LR2");
  });

  it("numbers strictly by sort_order, not insertion order", () => {
    const labels = computeTagLabels([win("w2", "LR", 5), win("w1", "LR", 1)]);
    expect(labels.get("w1")).toBe("LR1");
    expect(labels.get("w2")).toBe("LR2");
  });

  it("keeps different tag_base groups independent", () => {
    const labels = computeTagLabels([
      win("w1", "LR", 0),
      win("w2", "BR", 0),
      win("w3", "BR", 1),
    ]);
    expect(labels.get("w1")).toBe("LR");
    expect(labels.get("w2")).toBe("BR1");
    expect(labels.get("w3")).toBe("BR2");
  });

  it("handles three+ windows of the same tag", () => {
    const labels = computeTagLabels([
      win("w1", "BR", 0),
      win("w2", "BR", 1),
      win("w3", "BR", 2),
    ]);
    expect(labels.get("w1")).toBe("BR1");
    expect(labels.get("w2")).toBe("BR2");
    expect(labels.get("w3")).toBe("BR3");
  });

  it("excludes soft-deleted windows from numbering", () => {
    const labels = computeTagLabels([
      win("w1", "LR", 0),
      win("w2", "LR", 1, true), // deleted
      win("w3", "LR", 2),
    ]);
    // Only w1 and w3 remain -> back to a group of 2, numbered by sort_order.
    expect(labels.get("w1")).toBe("LR1");
    expect(labels.get("w3")).toBe("LR2");
    expect(labels.has("w2")).toBe(false);
  });
});
