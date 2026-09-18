import { describe, expect, it } from "vitest";
import { computeTagLabels, unitRooms } from "./tags";

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

describe("unitRooms", () => {
  const w = (tag_base: string, sort_order: number, deleted = false) => ({
    tag_base,
    sort_order,
    deleted,
  });

  it("lists each room once, in the order it was measured", () => {
    expect(unitRooms([w("LR", 0), w("LR", 1), w("BR", 2), w("K", 3), w("BR", 4)])).toEqual([
      "LR",
      "BR",
      "K",
    ]);
  });

  it("orders by sort_order, not by the array it was handed", () => {
    expect(unitRooms([w("K", 2), w("LR", 0), w("BR", 1)])).toEqual(["LR", "BR", "K"]);
  });

  it("shows nothing for an untagged zone run — that is the format, not a room", () => {
    expect(unitRooms([w("", 0), w("", 1), w("", 2)])).toEqual([]);
  });

  it("drops untagged windows but keeps the tagged ones around them", () => {
    expect(unitRooms([w("LR", 0), w("", 1), w("BR", 2)])).toEqual(["LR", "BR"]);
  });

  it("ignores deleted windows", () => {
    expect(unitRooms([w("LR", 0), w("BR", 1, true)])).toEqual(["LR"]);
  });

  it("is empty for a unit with nothing measured yet", () => {
    expect(unitRooms([])).toEqual([]);
  });

  it("gives the all-one-room unit a visibly shorter list than its neighbours", () => {
    // The whole point of putting this on the tile: 301 reads "LR" while the
    // unit next door reads "LR BR K", and the odd one out is obvious without
    // opening either.
    const oddOneOut = unitRooms([w("LR", 0), w("LR", 1), w("LR", 2)]);
    const neighbour = unitRooms([w("LR", 0), w("BR", 1), w("K", 2)]);
    expect(oddOneOut).toEqual(["LR"]);
    expect(neighbour).toHaveLength(3);
  });
});
