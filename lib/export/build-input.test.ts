import { describe, expect, it } from "vitest";
import { buildExportInput, localDateISO } from "./build-input";
import { buildNoteString } from "./shared";
import type { Floor, Unit, WindowRecord } from "../types";

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

/**
 * The snapshot is the only thing the workbook builder and the "changes since
 * last export" line ever see, so a field it forgets to copy is a field that
 * silently does not exist. That is exactly how a window marked Finished kept
 * exporting "TIGHT MEASURES" (2026-09-15): `measure_override` was on the
 * WindowRecord, on the ExportWindow type and honoured by the exporter, but
 * never copied across this seam.
 */
describe("buildExportInput carries the per-window overrides", () => {
  const floor: Floor = {
    id: "f1", updated_at: "2026-09-15T00:00:00Z", deleted: false,
    project_id: "p1", label: "Level 3", order_number: "", trips: null,
    defaults: {
      roll: false, drive: "R", tight: true, measure: "tight", mount: "inside",
      extra_note: "", d_value: "0.5",
      color_codes: { mbed: "", liv: "", bed: "", kit: "", stu: "" },
    },
  };
  const unit: Unit = {
    id: "u1", updated_at: "2026-09-15T00:00:00Z", deleted: false,
    floor_id: "f1", number: "301", status: "done", note: "",
    install: null, install_blocked: false, removed: 0, sort_order: 0,
  };
  const window = (over: Partial<WindowRecord>): WindowRecord => ({
    id: "w1", updated_at: "2026-09-15T00:00:00Z", deleted: false,
    unit_id: "u1", tag_base: "LR", tag_index: 0, widths: [480], height: 960,
    quantity: 1, control_override: null, deduct: null, longer_chain: false,
    note: "", sort_order: 0, ...over,
  });
  const build = (over: Partial<WindowRecord>) =>
    buildExportInput({
      projectName: "Job", floor, units: [unit],
      windowsByUnit: new Map([["u1", [window(over)]]]),
      exportDate: "2026-09-15",
    }).units[0].windows[0];

  it("copies a Finished override onto the snapshot", () => {
    expect(build({ measure_override: "finished" }).measure_override).toBe("finished");
  });

  it("copies the other three measure states too", () => {
    expect(build({ measure_override: "tight" }).measure_override).toBe("tight");
    expect(build({ measure_override: "none" }).measure_override).toBe("none");
    expect(build({}).measure_override).toBeNull();
  });

  it("still carries the legacy boolean beside it", () => {
    const w = build({ measure_override: "finished", tight_override: null });
    expect(w.measure_override).toBe("finished");
    expect(w.tight_override).toBeNull();
  });

  it("puts FINISHED MEASURES in the note a tight floor would have made tight", () => {
    const w = build({ measure_override: "finished" });
    const note = buildNoteString(floor.defaults, w.note, w.longer_chain, w.mount_override, {
      tightOverride: w.tight_override,
      measureOverride: w.measure_override,
      motorizedOverride: w.motorized_override,
      chainLength: w.chain_length,
    });
    expect(note).toContain("FINISHED MEASURES");
    expect(note).not.toContain("TIGHT MEASURES");
    // The mount still comes from the floor — this fix changes nothing there.
    expect(note).toContain("Inside Mount");
  });

  it("leaves a window with no override reading the floor's tight convention", () => {
    const w = build({});
    const note = buildNoteString(floor.defaults, w.note, w.longer_chain, w.mount_override, {
      tightOverride: w.tight_override,
      measureOverride: w.measure_override,
    });
    expect(note).toContain("TIGHT MEASURES");
  });
});
