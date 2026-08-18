import Dexie, { type Table } from "dexie";
import type { ExportRecord, Floor, Project, Unit, UnitPhoto, WindowRecord } from "./types";

/**
 * Local-first IndexedDB store (Dexie). The UI reads/writes here only —
 * every write is durable the instant it lands, and also appends an outbox
 * entry so a background sync loop can push it to Supabase later (see spec:
 * Autosave and sync). Pull side (Supabase -> here) is Phase 2's concern
 * (lib/sync/).
 */

export type OutboxTableName =
  | "projects"
  | "floors"
  | "units"
  | "windows"
  | "photos"
  | "exports";
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
  photos!: Table<UnitPhoto, string>;
  exports!: Table<ExportRecord, string>;
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
    // v2: job-site photos on unit notes (image inline as a data URL).
    this.version(2).stores({
      photos: "id, unit_id, updated_at, deleted",
    });
    // v3: export history — one snapshot per generated workbook, so a floor's
    // past exports can be re-downloaded and diffed against the current data.
    this.version(3).stores({
      exports: "id, floor_id, exported_at, updated_at, deleted",
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
  input: Omit<Floor, "id" | "updated_at" | "deleted" | "order_number" | "trips"> & {
    order_number?: string;
    trips?: number | null;
  }
): Promise<Floor> {
  return writeRow(db.floors, "floors", {
    ...input,
    order_number: input.order_number ?? "",
    trips: input.trips ?? null,
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
  input: Omit<Unit, "id" | "updated_at" | "deleted" | "note" | "install" | "install_blocked"> & {
    note?: string;
    install?: Unit["install"];
    install_blocked?: boolean;
  }
): Promise<Unit> {
  return writeRow(db.units, "units", {
    ...input,
    note: input.note ?? "",
    install: input.install ?? null,
    install_blocked: input.install_blocked ?? false,
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
  input: Omit<WindowRecord, "id" | "updated_at" | "deleted" | "quantity"> & {
    quantity?: number;
  }
): Promise<WindowRecord> {
  return writeRow(db.windows, "windows", {
    ...input,
    quantity: input.quantity ?? 1,
    tight_override: input.tight_override ?? null,
    chain_length: input.chain_length ?? null,
    motorized_override: input.motorized_override ?? null,
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
  window: Omit<WindowRecord, "updated_at" | "deleted" | "quantity"> & {
    updated_at?: string;
    deleted?: boolean;
    quantity?: number;
  }
): Promise<WindowRecord> {
  return writeRow(db.windows, "windows", {
    deleted: false,
    quantity: window.quantity ?? 1,
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

// ---------------------------------------------------------------------------
// Photos
// ---------------------------------------------------------------------------

export async function createPhoto(
  input: Omit<UnitPhoto, "id" | "updated_at" | "deleted">
): Promise<UnitPhoto> {
  return writeRow(db.photos, "photos", {
    ...input,
    id: newId(),
    updated_at: "",
    deleted: false,
  });
}

export async function deletePhoto(id: string): Promise<void> {
  const existing = await db.photos.get(id);
  if (!existing) return;
  await writeRow(db.photos, "photos", { ...existing, deleted: true }, "delete");
}

export async function listPhotos(unitId: string): Promise<UnitPhoto[]> {
  return db.photos.where("unit_id").equals(unitId).filter((p) => !p.deleted).toArray();
}

// ---------------------------------------------------------------------------
// Export history
// ---------------------------------------------------------------------------

export async function createExportRecord(
  input: Omit<ExportRecord, "id" | "updated_at" | "deleted">
): Promise<ExportRecord> {
  return writeRow(db.exports, "exports", {
    ...input,
    id: newId(),
    updated_at: "",
    deleted: false,
  });
}

/** A floor's exports, newest first. */
export async function listExports(floorId: string): Promise<ExportRecord[]> {
  const rows = await db.exports
    .where("floor_id")
    .equals(floorId)
    .filter((e) => !e.deleted)
    .toArray();
  return rows.sort((a, b) => b.exported_at.localeCompare(a.exported_at));
}

/** The most recent export of a floor, or undefined if it has never been exported. */
export async function latestExport(floorId: string): Promise<ExportRecord | undefined> {
  return (await listExports(floorId))[0];
}

export async function deleteExportRecord(id: string): Promise<void> {
  const existing = await db.exports.get(id);
  if (!existing) return;
  await writeRow(db.exports, "exports", { ...existing, deleted: true }, "delete");
}
