// The signed-out sandbox.
//
// The app used to seed four REAL client jobs (Arbour, 44 Charles, Cleveland,
// Alcon) on first run, so anyone opening it — on any device, signed out —
// saw a customer's measurements. This replaces that with an invented
// building, and the real jobs now arrive only from the server, behind
// sign-in and row-level security.
//
// Demo rows are local-only by construction: they are written straight to the
// tables, bypassing lib/db.ts's writeRow, so no outbox entry is ever created
// and nothing can push them to a company. They also carry a reserved
// company id that matches no real company.
import { db } from "./db";
import { DEMO_COMPANY_ID } from "./tenant";
import type { Floor, Project, Unit, WindowRecord } from "./types";

export { DEMO_COMPANY_ID };

const DEMO_VERSION_KEY = "demo:version";
/** Bump to replace the sandbox on devices that already have an older one. */
const DEMO_VERSION = 1;

const P = "demo-project-0001";
const F = "demo-floor-0001";

const now = () => new Date().toISOString();

function project(): Project {
  return {
    id: P, updated_at: now(), deleted: false,
    company_id: DEMO_COMPANY_ID,
    name: "Sample Building (demo)",
    address: "123 Example Street",
    building_type: "residential",
    tag_chips: ["LR", "BR", "MBR", "K", "STU"],
  } as Project;
}

function floor(): Floor {
  return {
    id: F, updated_at: now(), deleted: false,
    company_id: DEMO_COMPANY_ID,
    project_id: P,
    label: "Level 1",
    defaults: {
      roll: false, drive: "R", tight: true, measure: "tight", mount: null,
      extra_note: "", d_value: "1/2",
      color_codes: { mbed: "", liv: "", bed: "", kit: "", stu: "" },
    },
    order_number: "", trips: null,
  } as Floor;
}

interface DemoWindow {
  tag: string;
  index: number;
  widths: number[];
  height: number;
  deduct?: WindowRecord["deduct"];
  note?: string;
}

/**
 * Three units chosen to show the features a new person would otherwise not
 * discover: a plain room, a three-panel bay with a both-sides deduct, and a
 * unit already marked installed.
 */
const UNITS: { number: string; install: Unit["install"]; note: string; windows: DemoWindow[] }[] = [
  {
    number: "101", install: null, note: "",
    windows: [
      { tag: "LR", index: 0, widths: [1128], height: 1392 },
      { tag: "BR", index: 0, widths: [1280], height: 1008 },
    ],
  },
  {
    number: "102", install: null,
    note: "Try the bay: tap a panel width, and see how a deduct splits across the outer panels.",
    windows: [
      { tag: "LR", index: 0, widths: [546, 848, 550], height: 928, deduct: "D" },
      { tag: "BR", index: 0, widths: [1284], height: 1008 },
    ],
  },
  {
    number: "103", install: "done", note: "",
    windows: [{ tag: "MBR", index: 0, widths: [1454], height: 1392, deduct: "D" }],
  },
];

/** True when this row belongs to the signed-out sandbox. */
export function isDemoRow(row: { company_id?: string }): boolean {
  return row.company_id === DEMO_COMPANY_ID;
}

/**
 * Put the sandbox in place if it is missing. Writes directly to the tables so
 * nothing lands in the outbox — a demo row must never reach a real company.
 */
export async function seedDemoIfNeeded(): Promise<void> {
  const stored = (await db.meta.get(DEMO_VERSION_KEY))?.value as number | undefined;
  if (stored === DEMO_VERSION) return;

  const units: Unit[] = [];
  const windows: WindowRecord[] = [];
  UNITS.forEach((u, ui) => {
    const unitId = `demo-unit-${ui}`;
    units.push({
      id: unitId, updated_at: now(), deleted: false,
      company_id: DEMO_COMPANY_ID,
      floor_id: F, number: u.number, status: "active", note: u.note,
      install: u.install, install_blocked: false, sort_order: ui,
    } as Unit);
    u.windows.forEach((w, wi) => {
      windows.push({
        id: `demo-window-${ui}-${wi}`, updated_at: now(), deleted: false,
        company_id: DEMO_COMPANY_ID,
        unit_id: unitId, tag_base: w.tag, tag_index: w.index,
        widths: w.widths, height: w.height, quantity: 1,
        control_override: null, deduct: w.deduct ?? null,
        longer_chain: false, checks_ack: false, note: w.note ?? "",
        sort_order: wi,
      } as WindowRecord);
    });
  });

  await db.transaction("rw", db.projects, db.floors, db.units, db.windows, db.meta, async () => {
    await db.projects.put(project());
    await db.floors.put(floor());
    await db.units.bulkPut(units);
    await db.windows.bulkPut(windows);
    await db.meta.put({ key: DEMO_VERSION_KEY, value: DEMO_VERSION });
  });
}

/** Remove the sandbox — used when a real company's data arrives. */
export async function clearDemo(): Promise<void> {
  await db.transaction("rw", db.projects, db.floors, db.units, db.windows, db.meta, async () => {
    await db.windows.where("unit_id").startsWith("demo-unit-").delete();
    await db.units.where("floor_id").equals(F).delete();
    await db.floors.delete(F);
    await db.projects.delete(P);
    await db.meta.delete(DEMO_VERSION_KEY);
  });
}
