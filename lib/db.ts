import Dexie, { type Table } from "dexie";
import type { Floor, Project, Unit, WindowRecord } from "./types";

/**
 * Local-first IndexedDB store (Dexie). The UI reads/writes here only —
 * every write is durable the instant it lands, and also appends an outbox
 * entry so a background sync loop can push it to Supabase later (see spec:
 * Autosave and sync). Pull side (Supabase -> here) is Phase 2's concern
 * (lib/sync/).
 */

export type OutboxTableName = "projects" | "floors" | "units" | "windows";
export type OutboxOp = "put" | "delete";

export interface OutboxEntry {
  /** Auto-increment local id, not synced anywhere. */
  id?: number;
  table: OutboxTableName;
  rowId: string;
  op: OutboxOp;
  at: string;
}

export interface MetaEntry {
  key: string;
  value: unknown;
}

class MeasureDB extends Dexie {
  projects!: Table<Project, string>;
  floors!: Table<Floor, string>;
  units!: Table<Unit, string>;
  windows!: Table<WindowRecord, string>;
  outbox!: Table<OutboxEntry, number>;
  meta!: Table<MetaEntry, string>;

  constructor() {
    super("measure");
    this.version(1).stores({
      projects: "id, updated_at, deleted",
      floors: "id, project_id, updated_at, deleted",
      units: "id, floor_id, updated_at, deleted",
      windows: "id, unit_id, updated_at, deleted",
      outbox: "++id, table, rowId, at",
      meta: "key",
    });
  }
}

export const db = new MeasureDB();

function newId(): string {
  return crypto.randomUUID();
}

/**
 * Stamp a row's updated_at, write it to `table`, and append a matching
 * outbox entry, all in one transaction. Every CRUD helper below funnels
 * through this so autosave and sync bookkeeping can never drift apart.
 */
async function writeRow<T extends { id: string; updated_at: string; deleted: boolean }>(
  table: Table<T, string>,
  tableName: OutboxTableName,
  row: T,
  op: OutboxOp = "put"
): Promise<T> {
  const at = new Date().toISOString();
  const stamped: T = { ...row, updated_at: at };
  await db.transaction("rw", table, db.outbox, async () => {
    await table.put(stamped);
    await db.outbox.add({ table: tableName, rowId: stamped.id, op, at });
  });
  return stamped;
}

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

export async function createProject(
  input: Omit<Project, "id" | "updated_at" | "deleted">
): Promise<Project> {
  return writeRow(db.projects, "projects", {
    ...input,
    id: newId(),
    updated_at: "",
    deleted: false,
  });
}

export async function updateProject(
  id: string,
  patch: Partial<Omit<Project, "id">>
): Promise<Project> {
  const existing = await db.projects.get(id);
  if (!existing) throw new Error(`Project ${id} not found`);
  return writeRow(db.projects, "projects", { ...existing, ...patch });
}

export async function deleteProject(id: string): Promise<void> {
  const existing = await db.projects.get(id);
  if (!existing) return;
  await writeRow(db.projects, "projects", { ...existing, deleted: true }, "delete");
}

export async function listProjects(): Promise<Project[]> {
  return db.projects.filter((p) => !p.deleted).toArray();
}

export async function getProject(id: string): Promise<Project | undefined> {
  return db.projects.get(id);
}

// ---------------------------------------------------------------------------
// Floors
// ---------------------------------------------------------------------------

export async function createFloor(
  input: Omit<Floor, "id" | "updated_at" | "deleted">
): Promise<Floor> {
  return writeRow(db.floors, "floors", {
    ...input,
    id: newId(),
    updated_at: "",
    deleted: false,
  });
}

export async function updateFloor(
  id: string,
  patch: Partial<Omit<Floor, "id">>
): Promise<Floor> {
  const existing = await db.floors.get(id);
  if (!existing) throw new Error(`Floor ${id} not found`);
  return writeRow(db.floors, "floors", { ...existing, ...patch });
}

export async function deleteFloor(id: string): Promise<void> {
  const existing = await db.floors.get(id);
  if (!existing) return;
  await writeRow(db.floors, "floors", { ...existing, deleted: true }, "delete");
}

export async function listFloors(projectId: string): Promise<Floor[]> {
  return db.floors.where("project_id").equals(projectId).filter((f) => !f.deleted).toArray();
}

export async function getFloor(id: string): Promise<Floor | undefined> {
  return db.floors.get(id);
}

// ---------------------------------------------------------------------------
// Units
// ---------------------------------------------------------------------------

export async function createUnit(
  input: Omit<Unit, "id" | "updated_at" | "deleted" | "note"> & { note?: string }
): Promise<Unit> {
  return writeRow(db.units, "units", {
    ...input,
    note: input.note ?? "",
    id: newId(),
    updated_at: "",
    deleted: false,
  });
}

export async function updateUnit(id: string, patch: Partial<Omit<Unit, "id">>): Promise<Unit> {
  const existing = await db.units.get(id);
  if (!existing) throw new Error(`Unit ${id} not found`);
  return writeRow(db.units, "units", { ...existing, ...patch });
}

export async function deleteUnit(id: string): Promise<void> {
  const existing = await db.units.get(id);
  if (!existing) return;
  await writeRow(db.units, "units", { ...existing, deleted: true }, "delete");
}

export async function listUnits(floorId: string): Promise<Unit[]> {
  return db.units.where("floor_id").equals(floorId).filter((u) => !u.deleted).toArray();
}

export async function getUnit(id: string): Promise<Unit | undefined> {
  return db.units.get(id);
}

// ---------------------------------------------------------------------------
// Windows
// ---------------------------------------------------------------------------

export async function createWindow(
  input: Omit<WindowRecord, "id" | "updated_at" | "deleted">
): Promise<WindowRecord> {
  return writeRow(db.windows, "windows", {
    ...input,
    id: newId(),
    updated_at: "",
    deleted: false,
  });
}

/**
 * Create-or-update a window row. The window entry screen autosaves on every
 * field change (see spec), so callers typically hold the full row in memory
 * and call this on each edit rather than diffing a patch.
 */
export async function upsertWindow(
  window: Omit<WindowRecord, "updated_at" | "deleted"> & {
    updated_at?: string;
    deleted?: boolean;
  }
): Promise<WindowRecord> {
  return writeRow(db.windows, "windows", {
    deleted: false,
    ...window,
    updated_at: window.updated_at ?? "",
  } as WindowRecord);
}

export async function deleteWindow(id: string): Promise<void> {
  const existing = await db.windows.get(id);
  if (!existing) return;
  await writeRow(db.windows, "windows", { ...existing, deleted: true }, "delete");
}

export async function listWindows(unitId: string): Promise<WindowRecord[]> {
  return db.windows.where("unit_id").equals(unitId).filter((w) => !w.deleted).toArray();
}

export async function getWindow(id: string): Promise<WindowRecord | undefined> {
  return db.windows.get(id);
}

// ---------------------------------------------------------------------------
// Meta (device-local preferences: precision switch, last sync time, etc.)
// ---------------------------------------------------------------------------

export async function getMeta<T = unknown>(key: string): Promise<T | undefined> {
  const row = await db.meta.get(key);
  return row?.value as T | undefined;
}

export async function setMeta(key: string, value: unknown): Promise<void> {
  await db.meta.put({ key, value });
}

// ---------------------------------------------------------------------------
// Outbox (consumed by lib/sync/, Phase 2)
// ---------------------------------------------------------------------------

export async function listOutbox(): Promise<OutboxEntry[]> {
  return db.outbox.orderBy("at").toArray();
}

export async function clearOutboxEntry(id: number): Promise<void> {
  await db.outbox.delete(id);
}
