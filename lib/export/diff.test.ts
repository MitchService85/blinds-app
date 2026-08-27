import { describe, expect, it } from "vitest";
import { diffExports, summarizeDiff } from "./diff";
import { buildWorkbook } from "./exporter";
import { countBlinds } from "./build-input";
import type { ExportInput } from "./shared";
import inputFixture from "../../fixtures/level4-input.json";
import goldenFixture from "../../fixtures/level4-golden.json";

const base = (): ExportInput => JSON.parse(JSON.stringify(inputFixture)) as ExportInput;

/** Deep-clone a snapshot and hand it to `mutate` for editing. */
function edit(input: ExportInput, mutate: (i: ExportInput) => void): ExportInput {
  const copy = JSON.parse(JSON.stringify(input)) as ExportInput;
  mutate(copy);
  return copy;
}

describe("diffExports", () => {
  it("reports nothing when the snapshot is unchanged", () => {
    const d = diffExports(base(), base());
    expect(d.identical).toBe(true);
    expect(d.windows).toHaveLength(0);
    expect(summarizeDiff(d)).toBe("no changes since");
  });

  it("catches a changed width and shows old to new", () => {
    const next = edit(base(), (i) => {
      i.units[0].windows[0].widths[0] += 16; // one inch wider
    });
    const d = diffExports(base(), next);
    expect(d.changed).toBe(1);
    expect(d.identical).toBe(false);
    const change = d.windows[0];
    expect(change.kind).toBe("changed");
    expect(change.fields[0].label).toBe("Width");
    expect(change.fields[0].from).not.toBe(change.fields[0].to);
  });

  it("catches a changed height", () => {
    const next = edit(base(), (i) => {
      i.units[0].windows[0].height -= 16;
    });
    const d = diffExports(base(), next);
    expect(d.changed).toBe(1);
    expect(d.windows[0].fields.map((f) => f.label)).toContain("Height");
  });

  it("reports an added window", () => {
    const next = edit(base(), (i) => {
      const w = JSON.parse(JSON.stringify(i.units[0].windows[0]));
      w.id = "brand-new-window";
      w.tag_index = 9;
      i.units[0].windows.push(w);
    });
    const d = diffExports(base(), next);
    expect(d.added).toBe(1);
    expect(d.windows.some((w) => w.kind === "added")).toBe(true);
  });

  it("reports a removed window", () => {
    const next = edit(base(), (i) => {
      i.units[0].windows.pop();
    });
    const d = diffExports(base(), next);
    expect(d.removed).toBe(1);
    expect(d.windows.some((w) => w.kind === "removed")).toBe(true);
  });

  it("treats a unit marked N/A as removed, matching what the workbook emits", () => {
    const prev = base();
    const exportedFromFirstUnit = prev.units[0].windows.length;
    const next = edit(prev, (i) => {
      i.units[0].status = "na";
    });
    const d = diffExports(prev, next);
    expect(d.removed).toBe(exportedFromFirstUnit);
  });

  it("flags a D value change, which rewrites every blind but only one cell", () => {
    const next = edit(base(), (i) => {
      i.defaults.d_value = "1/4";
    });
    const d = diffExports(base(), next);
    expect(d.identical).toBe(false);
    expect(d.windows).toHaveLength(0); // no per-window edit at all
    expect(d.floor.map((f) => f.label)).toContain("D value");
    expect(summarizeDiff(d)).toContain("floor setting");
  });

  it("flags a floor mount change", () => {
    const next = edit(base(), (i) => {
      i.defaults.mount = "outside";
      i.defaults.tight = false;
    });
    const d = diffExports(base(), next);
    expect(d.floor.map((f) => f.label)).toContain("Mount");
  });

  it("a pre-row-id snapshot diffed against live (id-carrying) data is not N added + N removed", () => {
    // Old stored ExportRecords predate row ids; buildExportInput always sets
    // them. Keying one side by id and the other positionally reported a
    // byte-identical export as everything-added-everything-removed.
    const prev = base(); // fixture carries no ids
    const next = edit(base(), (i) => {
      i.units.forEach((u, ui) =>
        u.windows.forEach((w, wi) => {
          w.id = `w-${ui}-${wi}`;
        })
      );
    });
    const d = diffExports(prev, next);
    expect(d.identical).toBe(true);
    expect(d.added).toBe(0);
    expect(d.removed).toBe(0);
  });

  it("a legacy inside_tight override diffs on the Tight row, not as a mount change", () => {
    const withOverride = (mount_override: "inside_tight" | null): ExportInput =>
      edit(base(), (i) => {
        i.units = [
          {
            number: "701",
            status: "active",
            windows: [
              { id: "w1", tag_base: "LR", tag_index: 0, widths: [500], height: 900, quantity: 1,
                control_override: null, deduct: null, longer_chain: false, note: "",
                ...(mount_override ? { mount_override } : { mount_override: null }) },
            ],
          },
        ];
      });
    const d = diffExports(withOverride("inside_tight"), withOverride(null));
    const labels = d.windows[0]?.fields.map((f) => f.label) ?? [];
    // The tight convention changed (yes -> floor default); the mount did not
    // ("inside_tight" never meant an inside mount).
    expect(labels).toContain("Tight");
    expect(labels).not.toContain("Mount");
  });

  it("matches by row id, so reordering a unit's windows is not a change", () => {
    const prev = edit(base(), (i) => {
      i.units.forEach((u, ui) =>
        u.windows.forEach((w, wi) => {
          w.id = `w-${ui}-${wi}`;
        })
      );
    });
    const next = edit(prev, (i) => {
      i.units[0].windows.reverse();
    });
    expect(diffExports(prev, next).identical).toBe(true);
  });
});

describe("export snapshots", () => {
  it("regenerates the golden workbook from a stored snapshot", () => {
    // The whole point of snapshotting the input rather than the .xlsx bytes:
    // a history entry must reproduce the exact file that was sent.
    const golden: Record<string, unknown> = goldenFixture;
    const sheet = buildWorkbook(base()).getWorksheet("Window Shades");
    expect(sheet).toBeDefined();
    // Excel gives dates back as Date objects; the fixture stores yyyy-mm-dd.
    const norm = (v: unknown) =>
      v instanceof Date ? v.toISOString().slice(0, 10) : v;
    for (const [ref, expected] of Object.entries(golden)) {
      if (typeof expected !== "string" && typeof expected !== "number") continue;
      expect(norm(sheet!.getCell(ref).value)).toEqual(expected);
    }
  });

  it("counts blinds per panel and multiplies by quantity", () => {
    const input = edit(base(), (i) => {
      i.units = [
        {
          number: "X",
          status: "active",
          windows: [
            { tag_base: "LR", tag_index: 0, widths: [100, 200, 300], height: 900, quantity: 2,
              control_override: null, deduct: null, longer_chain: false, note: "" },
          ],
        },
      ];
    });
    expect(countBlinds(input)).toBe(6);
  });

  it("excludes N/A units from the blind count", () => {
    const input = edit(base(), (i) => {
      i.units.forEach((u) => {
        u.status = "na";
      });
    });
    expect(countBlinds(input)).toBe(0);
  });
});

describe("motorized and chain", () => {
  const withWindow = (patch: Record<string, unknown>): ExportInput =>
    edit(base(), (i) => {
      i.units = [
        {
          number: "301",
          status: "active",
          windows: [
            {
              tag_base: "LR",
              tag_index: 0,
              widths: [1000],
              height: 900,
              quantity: 1,
              control_override: null,
              deduct: null,
              longer_chain: false,
              note: "",
              ...patch,
            },
          ],
        },
      ];
    });

  const noteAt = (input: ExportInput, row = 10) =>
    buildWorkbook(input).getWorksheet("Window Shades")!.getCell(row, 11).value;
  const chainAt = (input: ExportInput, row = 10) =>
    buildWorkbook(input).getWorksheet("Window Shades")!.getCell(row, 7).value;

  it("writes chain length as a number in the Chain column", () => {
    expect(chainAt(withWindow({ chain_length: 72 }))).toBe(72);
  });

  it("leaves the Chain column empty when no length is set", () => {
    expect(chainAt(withWindow({}))).toBeNull();
  });

  it("drops LONGER CHAIN from the note once a length is given", () => {
    // Mitch's call: the number says it better than the phrase.
    const withPhrase = withWindow({ longer_chain: true });
    expect(String(noteAt(withPhrase))).toContain("LONGER CHAIN");

    const withNumber = withWindow({ longer_chain: true, chain_length: 96 });
    expect(String(noteAt(withNumber))).not.toContain("LONGER CHAIN");
    expect(chainAt(withNumber)).toBe(96);
  });

  it("notes MOTORIZED from the floor default", () => {
    const input = withWindow({});
    input.defaults.motorized = true;
    expect(String(noteAt(input))).toContain("MOTORIZED");
  });

  it("lets a window opt out of a motorized floor", () => {
    const input = withWindow({ motorized_override: false });
    input.defaults.motorized = true;
    expect(String(noteAt(input))).not.toContain("MOTORIZED");
  });

  it("lets a window opt in on a non-motorized floor", () => {
    const input = withWindow({ motorized_override: true });
    input.defaults.motorized = false;
    expect(String(noteAt(input))).toContain("MOTORIZED");
  });

  it("appends the floor's chain type", () => {
    const input = withWindow({});
    input.defaults.chain_type = "Metal";
    expect(String(noteAt(input))).toContain("Metal chain");
  });

  it("diffs chain length and motorized override", () => {
    const prev = withWindow({ chain_length: 72 });
    const next = withWindow({ chain_length: 96, motorized_override: true });
    const d = diffExports(prev, next);
    const labels = d.windows[0].fields.map((f) => f.label);
    expect(labels).toContain("Chain length");
    expect(labels).toContain("Motorized");
  });

  it("diffs floor-level motorized and chain type", () => {
    const prev = withWindow({});
    const next = withWindow({});
    next.defaults.motorized = true;
    next.defaults.chain_type = "Metal";
    const d = diffExports(prev, next);
    const labels = d.floor.map((f) => f.label);
    expect(labels).toContain("Motorized");
    expect(labels).toContain("Chain type");
  });
});

describe("per-panel control", () => {
  const bay = (patch: Record<string, unknown>): ExportInput =>
    edit(base(), (i) => {
      i.defaults.drive = "R";
      i.units = [
        {
          number: "601",
          status: "active",
          windows: [
            { tag_base: "LR", tag_index: 0, widths: [500, 800, 500], height: 900, quantity: 1,
              control_override: null, deduct: null, longer_chain: false, note: "", ...patch },
          ],
        },
      ];
    });

  const controls = (input: ExportInput) => {
    const sheet = buildWorkbook(input).getWorksheet("Window Shades")!;
    return [10, 11, 12].map((r) => sheet.getCell(r, 9).value);
  };

  it("falls back to the floor's drive side on every panel", () => {
    expect(controls(bay({}))).toEqual(["R", "R", "R"]);
  });

  it("puts left control on the left panel only (15 Neighborhood)", () => {
    expect(controls(bay({ panel_controls: ["L", null, null] }))).toEqual(["R", "R", "R"].map((d, i) => (i === 0 ? "L" : d)));
  });

  it("lets the whole-window override stand in for unset panels", () => {
    expect(controls(bay({ control_override: "L" }))).toEqual(["L", "L", "L"]);
  });

  it("a panel setting beats the whole-window override", () => {
    expect(controls(bay({ control_override: "L", panel_controls: [null, "R", null] })))
      .toEqual(["L", "R", "L"]);
  });

  it("diffs a change to per-panel control", () => {
    const d = diffExports(bay({}), bay({ panel_controls: ["L", null, null] }));
    expect(d.identical).toBe(false);
  });
});

describe("tag and unit renames", () => {
  const withIds = (): ExportInput =>
    edit(base(), (i) => {
      i.units.forEach((u, ui) => {
        u.id = `u-${ui}`;
        u.windows.forEach((w, wi) => {
          w.id = `w-${ui}-${wi}`;
        });
      });
    });

  it("reports a retag as a change, not as identical", () => {
    const prev = withIds();
    const next = edit(prev, (i) => {
      i.units[0].windows[0].tag_base = "MBR";
    });
    const d = diffExports(prev, next);
    expect(d.identical).toBe(false);
    expect(d.windows[0].fields.map((f) => f.label)).toContain("Tag");
  });

  it("reports a unit renumber", () => {
    const prev = withIds();
    const next = edit(prev, (i) => {
      i.units[0].number = "499";
    });
    const d = diffExports(prev, next);
    expect(d.identical).toBe(false);
    expect(d.windows.some((w) => w.fields.some((f) => f.label === "Unit"))).toBe(true);
  });
});

describe("legacy color_codes keys", () => {
  it("exports a pre-rename floor's kitchen and studio codes into KIT and STU", () => {
    const input = edit(base(), (i) => {
      // A floor row written by a phone on the old bundle.
      (i.defaults as unknown as Record<string, unknown>).color_codes = {
        bed: "YUNOWH", liv: "PWS1WHIT", studio: "PWS3PLAT", kitchen: "KCODE",
      };
    });
    const sheet = buildWorkbook(input).getWorksheet("Window Shades")!;
    expect(sheet.getCell("G6").value).toBe("KCODE");   // KIT <- kitchen
    expect(sheet.getCell("G7").value).toBe("PWS3PLAT"); // STU <- studio
    expect(sheet.getCell("G5").value).toBe("YUNOWH");   // BED <- bed
  });

  it("does not report phantom colour changes across the rename", () => {
    const prev = edit(base(), (i) => {
      (i.defaults as unknown as Record<string, unknown>).color_codes = {
        bed: "YUNOWH", liv: "PWS1WHIT", studio: "PWS3PLAT", kitchen: "",
      };
    });
    const next = edit(base(), (i) => {
      i.defaults.color_codes = { mbed: "", liv: "PWS1WHIT", bed: "YUNOWH", kit: "", stu: "PWS3PLAT" };
    });
    expect(diffExports(prev, next).floor).toHaveLength(0);
  });
});
