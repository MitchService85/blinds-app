import { describe, expect, it } from "vitest";
import {
  CANT_REASONS,
  billedInvoiceIds,
  blindCount,
  dropsWithDeficiency,
  fixCounts,
  fixInvoiceLines,
  fixLineLabel,
  fixQtyFor,
  fixedUnbilled,
  followsDeficiencyNote,
  gatherFixItems,
  inBatchIds,
  isGuessedNote,
  noteForStatus,
  readyToBill,
  reopenedOnInvoice,
  suggestedFixNote,
  toggleQuickNote,
} from "./fixes";
import type { Deficiency, FixItem, Unit, WindowRecord } from "./types";

function unit(id: string, number: string, sort_order: number, install_blocked = false): Unit {
  return {
    id, number, sort_order, install_blocked, floor_id: "f4", status: "done", note: "",
    install: "done", updated_at: "", deleted: false,
  };
}

function win(id: string, unit_id: string, tag_base: string, tag_index: number, issue: Partial<WindowRecord>, panels = 3): WindowRecord {
  return {
    id, unit_id, tag_base, tag_index, widths: Array(panels).fill(16 * 30), height: 16 * 60, quantity: 1,
    control_override: null, deduct: null, longer_chain: false, note: "", sort_order: tag_index,
    updated_at: "", deleted: false, issue_note: "", issue_fault: null, issue_recut: false, ...issue,
  };
}

describe("fixQtyFor", () => {
  // Real Batch 4 notes, 44 Charles.
  it("counts one fix per panel the note names", () => {
    expect(fixQtyFor("Left side no deduction, right side shim and 1/4 deduction", 3)).toBe(2);
    expect(fixQtyFor("Right side no deduction", 3)).toBe(1);
    expect(fixQtyFor("Both sides need shims and no reduction", 3)).toBe(2);
    expect(fixQtyFor("No reduction ", 3)).toBe(2);
  });
  it("is one for a single blind, and never zero", () => {
    expect(fixQtyFor("No deduct", 1)).toBe(1);
    expect(fixQtyFor("", 3)).toBe(1);
  });
});

describe("toggleQuickNote", () => {
  it("adds, appends and removes", () => {
    expect(toggleQuickNote("", "Shimmed")).toBe("Shimmed");
    expect(toggleQuickNote("Shimmed", "New blind installed")).toBe("Shimmed, New blind installed");
    expect(toggleQuickNote("Shimmed, New blind installed", "shimmed")).toBe("New blind installed");
  });
});

describe("gatherFixItems", () => {
  const units = [unit("u1206", "1206", 2), unit("u705", "705", 1, true)];
  const def = (id: string, unit_id: string, window_id: string | null, note: string, extra: Partial<Deficiency> = {}): Deficiency => ({
    id, unit_id, window_id, note, project_id: "p", share_id: null, raised_by: "Crew", raised_at: "2026-10-01T00:00:00Z",
    status: "open", resolved_at: null, fault: null, recut: false, fix_note: "", updated_at: "", deleted: false, ...extra,
  });
  const floors = [
    {
      id: "f4",
      units: [
        {
          unit: units[0],
          windows: [win("w-lr2", "u1206", "LR", 2, {}), win("w-lr1", "u1206", "LR", 1, {}), win("w-k", "u1206", "K", 0, {})],
          deficiencies: [
            def("d-lr2", "u1206", "w-lr2", "Left side no deduction"),
            def("d-lr1", "u1206", "w-lr1", "Right side no deduction"),
            // Fixed already: the record stays, nothing to gather.
            def("d-k", "u1206", "w-k", "Needs 1/8 cut off", { status: "resolved", resolved_at: "2026-10-20T00:00:00Z" }),
            // About the whole unit: not a blind to fix.
            def("d-unit", "u1206", null, "Locked out"),
          ],
        },
        {
          unit: units[1],
          windows: [win("w-br", "u705", "BR", 0, {})],
          deficiencies: [
            def("d-br-stain", "u705", "w-br", "Stain on blind, needs replacement", { raised_at: "2026-10-22T00:00:00Z" }),
            def("d-br", "u705", "w-br", "Left side no deduct, right side no deduct", { fault: "measure" }),
          ],
        },
      ],
    },
  ];

  it("one entry per open problem, in unit then blind order, oldest problem first", () => {
    const items = gatherFixItems(floors);
    expect(items.map((i) => `${i.unit_number} ${i.blind_label} ${i.deficiency_id}`)).toEqual([
      "705 BR d-br",
      "705 BR d-br-stain",
      "1206 LR1 d-lr1",
      "1206 LR2 d-lr2",
    ]);
    expect(items.map((i) => i.sort_order)).toEqual([0, 1, 2, 3]);
    expect(items[0]).toMatchObject({ qty: 2, unit_was_blocked: true, billable: false, status: "open" });
    expect(items[2]).toMatchObject({ qty: 1, billable: true, problem: "Right side no deduction" });
  });

  it("skips problems already waiting in a batch", () => {
    const items = gatherFixItems(floors, new Set(["d-br", "d-lr1"]), 10);
    expect(items.map((i) => i.deficiency_id)).toEqual(["d-br-stain", "d-lr2"]);
    expect(items[0].sort_order).toBe(10);
  });

  it("inBatchIds counts waiting entries only", () => {
    expect([...inBatchIds([
      { status: "open", deficiency_id: "a" },
      { status: "cant", deficiency_id: "b" },
      { status: "fixed", deficiency_id: "c" },
      { status: "open", deficiency_id: null },
    ])]).toEqual(["a", "b"]);
  });
});

describe("billing", () => {
  const base: FixItem = {
    id: "i", batch_id: "b", project_id: "p", floor_id: "f", unit_id: "u", window_id: "w",
    unit_number: "1206", blind_label: "LR1", panels: 3, problem: "Right side no deduction",
    fault: null, recut: false, unit_was_blocked: false, status: "fixed", fix_note: "Shimmed",
    qty: 1, billable: true, fixed_at: "x", invoice_id: null, sort_order: 0, updated_at: "", deleted: false,
  };

  it("bills fixed, billable, unbilled blinds only — a deleted invoice frees its fixes", () => {
    const items: FixItem[] = [
      base,
      { ...base, id: "open", status: "open" },
      { ...base, id: "cant", status: "cant" },
      { ...base, id: "ours", billable: false },
      { ...base, id: "billed", invoice_id: "inv1" },
      { ...base, id: "orphan", invoice_id: "gone" },
    ];
    expect(readyToBill(items, new Set(["inv1"])).map((i) => i.id)).toEqual(["i", "orphan"]);
    expect(fixCounts(items)).toEqual({ open: 1, fixed: 4, cant: 1, total: 6 });
  });

  it("writes one line per blind at qty x rate", () => {
    const [line] = fixInvoiceLines([{ ...base, qty: 2 }], 2500);
    expect(line).toMatchObject({ qty: 2, unit_cents: 2500, amount_cents: 5000 });
    expect(line.label).toBe("Fix 1206 LR1 — Right side no deduction. Done: Shimmed");
    expect(fixLineLabel({ ...base, problem: "", fix_note: "" })).toBe("Fix 1206 LR1");
  });
});

describe("suggestedFixNote", () => {
  // Real Batch 4 notes: the factory remade the wrong-deduct blinds, the crew shims.
  it("reads the likely fix off the problem", () => {
    expect(suggestedFixNote("Right side no deduction")).toBe("New blind installed");
    expect(suggestedFixNote("Left side no deduction, right side shim and 1/4 deduction")).toBe("Shimmed, New blind installed");
    expect(suggestedFixNote("Left side shim no deduction, Right side shim no deduction")).toBe("Shimmed, New blind installed");
    expect(suggestedFixNote("Missing pull tabs")).toBe("Pull tabs added");
    expect(suggestedFixNote("Bedroom blind rubbing")).toBe("");
  });
});

describe("the guessed note", () => {
  const item = { problem: "Bottom rail rubbing, needs shim", fix_note: "", status: "open" as const };

  it("✓ Fixed on an empty note fills in the guess, and says so", () => {
    const note = noteForStatus(item, "fixed");
    expect(note).toBe("Shimmed");
    expect(isGuessedNote({ ...item, fix_note: note })).toBe(true);
    // Once anything is added it is the crew's note, not a guess.
    expect(isGuessedNote({ ...item, fix_note: "Shimmed, Adjusted" })).toBe(false);
    expect(isGuessedNote({ problem: "Bedroom blind rubbing", fix_note: "" })).toBe(false);
  });

  it("keeps what was typed", () => {
    expect(noteForStatus({ ...item, fix_note: "Re-hung" }, "fixed")).toBe("Re-hung");
    expect(noteForStatus({ ...item, status: "fixed", fix_note: "Shimmed left side" }, "open")).toBe("Shimmed left side");
  });

  it("Undo takes an untouched guess back out", () => {
    expect(noteForStatus({ ...item, status: "fixed", fix_note: "Shimmed" }, "open")).toBe("");
  });

  it("Undo on Can't fix clears reason chips only, never a written reason", () => {
    expect(noteForStatus({ ...item, status: "cant", fix_note: "Needs remake, No access" }, "open")).toBe("");
    expect(noteForStatus({ ...item, status: "cant", fix_note: "Needs remake, tenant away" }, "open")).toBe(
      "Needs remake, tenant away"
    );
    expect(CANT_REASONS).toContain("Needs a part");
  });
});

describe("keeping a batch in step with its deficiencies", () => {
  const live = new Set(["inv1"]);
  const row = { status: "open" as FixItem["status"], invoice_id: null as string | null, deleted: false };

  it("a note edited on the unit screen follows to the entry until it is billed", () => {
    expect(followsDeficiencyNote(row, live)).toBe(true);
    expect(followsDeficiencyNote({ ...row, invoice_id: "inv1" }, live)).toBe(false);
    // The invoice was deleted: nothing holds the line any more.
    expect(followsDeficiencyNote({ ...row, invoice_id: "gone" }, live)).toBe(true);
    expect(followsDeficiencyNote({ ...row, deleted: true }, live)).toBe(false);
  });

  it("a deficiency removed as a mistake takes its waiting entry with it, not a fixed or billed one", () => {
    expect(dropsWithDeficiency(row, live)).toBe(true);
    expect(dropsWithDeficiency({ ...row, status: "cant" }, live)).toBe(true);
    expect(dropsWithDeficiency({ ...row, status: "fixed" }, live)).toBe(false);
    expect(dropsWithDeficiency({ ...row, invoice_id: "inv1" }, live)).toBe(false);
  });

  it("reopened after billing reads as on that invoice, not unbilled", () => {
    const reopened = { ...row, invoice_id: "inv1" };
    expect(reopenedOnInvoice(reopened, live)).toBe(true);
    expect(reopenedOnInvoice({ ...reopened, status: "fixed" }, live)).toBe(false);
    expect(reopenedOnInvoice(row, live)).toBe(false);
  });
});

describe("batch counts", () => {
  const base: FixItem = {
    id: "i", batch_id: "b", project_id: "p", floor_id: "f", unit_id: "u", window_id: "w1",
    unit_number: "101", blind_label: "LR", panels: 1, problem: "", fault: null, recut: false,
    unit_was_blocked: false, status: "fixed", fix_note: "", qty: 1, billable: true, fixed_at: "x",
    invoice_id: null, sort_order: 0, updated_at: "", deleted: false,
  };

  it("counts blinds, not deficiencies", () => {
    expect(blindCount([base, { ...base, id: "j" }, { ...base, id: "k", window_id: "w2" }])).toBe(2);
  });

  it("bill rows are every fixed, unbilled entry, charged or not; invoices listed once", () => {
    const items: FixItem[] = [
      base,
      { ...base, id: "ours", billable: false, fault: "measure" },
      { ...base, id: "billed", invoice_id: "inv1" },
      { ...base, id: "billed2", invoice_id: "inv1" },
      { ...base, id: "open", status: "open" },
    ];
    expect(fixedUnbilled(items, new Set(["inv1"])).map((i) => i.id)).toEqual(["i", "ours"]);
    expect(readyToBill(items, new Set(["inv1"])).map((i) => i.id)).toEqual(["i"]);
    expect(billedInvoiceIds(items, new Set(["inv1"]))).toEqual(["inv1"]);
    expect(billedInvoiceIds(items, new Set())).toEqual([]);
  });
});
