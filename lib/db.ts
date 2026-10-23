import Dexie, { type Table } from "dexie";
import type {
  Company,
  Deficiency,
  ExportRecord,
  FixBatch,
  FixItem,
  Floor,
  InvoiceRecord,
  Membership,
  Project,
  ProjectShare,
  Trip,
  Unit,
  UnitPhoto,
  WindowRecord,
} from "./types";
import { DEMO_COMPANY_ID, getCompanyIdSync, setCompanyIdCache } from "./tenant";
import { carryUnitNumber, compareFloorLabels } from "./floor-copy";
import { notifyLocalWrite } from "./sync-events";
import { CREW, deficiencyOpen, hasLegacyIssue, legacyIssueId, legacyIssueOpen } from "./issues";

/**
 * Local-first IndexedDB store (Dexie). The UI reads/writes here only —
 * every write is durable the instant it lands, and also appends an outbox
 * entry so a background sync loop can push it to Supabase later (see spec:
 * Autosave and sync). Pull side (Supabase -> here) is Phase 2's concern
 * (lib/sync/).
 */

export type OutboxTableName =
  | "companies"
  | "memberships"
  | "projects"
  | "floors"
  | "units"
  | "windows"
  | "photos"
  | "exports"
  | "invoices"
  | "project_shares"
  | "deficiencies"
  | "trips"
  | "fix_batches"
  | "fix_items";
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
  invoices!: Table<InvoiceRecord, string>;
  project_shares!: Table<ProjectShare, string>;
  deficiencies!: Table<Deficiency, string>;
  trips!: Table<Trip, string>;
  fix_batches!: Table<FixBatch, string>;
  fix_items!: Table<FixItem, string>;
  companies!: Table<Company, string>;
  memberships!: Table<Membership, string>;
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
    // v4: compound index so latestExport can read exactly one record instead
    // of materializing every snapshot the floor has ever exported.
    this.version(4).stores({
      exports: "id, floor_id, exported_at, updated_at, deleted, [floor_id+exported_at]",
    });
    // v5: the tenant tables. Cached locally like everything else so the
    // company name and roster render offline.
    this.version(5).stores({
      companies: "id, updated_at, deleted",
      memberships: "id, company_id, updated_at, deleted",
    });
    // v6: invoices. Indexed by project for the Money card's list and by
    // issue_date so the invoices screen can order without a full scan.
    this.version(6).stores({
      invoices: "id, project_id, issue_date, status, updated_at, deleted",
    });
    // v7: PM share links and the deficiencies they raise.
    this.version(7).stores({
      project_shares: "id, project_id, updated_at, deleted",
      deficiencies: "id, project_id, unit_id, status, updated_at, deleted",
    });
    // v8: the site-trip log. Indexed by project (the card lists one project's
    // trips) and by date (they read newest first).
    this.version(8).stores({
      trips: "id, project_id, date, updated_at, deleted",
    });
    // v9: deficiency fix batches and the blinds in them.
    this.version(9).stores({
      fix_batches: "id, project_id, updated_at, deleted",
      fix_items: "id, batch_id, project_id, updated_at, deleted",
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
  // Stamp the acting company here, in the one funnel every create and update
  // passes through, so no call site can forget it. The server rejects a write
  // carrying anyone else's id, so a wrong or missing stamp is a failed sync
  // rather than a cross-tenant leak — but it must be right locally too, or the
  // row never lands. An existing company_id is never overwritten: pulled rows
  // and merges keep the company they were created under.
  // `companies` is the tenant itself and is keyed by `id`; it has no
  // company_id column, so stamping one would push a field the server does not
  // have and the whole table's sync would fail.
  const stampsCompany = tableName !== "companies";
  const withCompany = row as T & { company_id?: string };
  const companyId = getCompanyIdSync();
  const stamped: T = {
    ...row,
    ...(stampsCompany && companyId && !withCompany.company_id
      ? { company_id: companyId }
      : {}),
    updated_at: at,
  };
  // A sandbox row is durable locally but must never be queued for sync. The
  // server has no such company, so a push would be rejected forever and wedge
  // that table's outbox — the stuck-sync failure from August. Seeding already
  // bypasses this funnel; this covers rows the visitor EDITS (setting pricing
  // on the demo project queued it before this guard existed).
  const isDemo = (stamped as T & { company_id?: string }).company_id === DEMO_COMPANY_ID;
  await db.transaction("rw", table, db.outbox, async () => {
    await table.put(stamped);
    if (!isDemo) await db.outbox.add({ table: tableName, rowId: stamped.id, op, at });
  });
  // Tell the sync loop there is something to send, so it goes up in seconds
  // rather than on the next minute's round — by which time the phone is
  // often locked in a pocket.
  if (!isDemo) notifyLocalWrite();
  return stamped;
}

/**
 * A child row belongs to its PARENT's company, not to whatever this device
 * happens to be acting as.
 *
 * That is what seals the signed-out sandbox: a window added to a demo unit,
 * or an invoice raised against the demo project, inherits the demo company
 * and so is skipped by the outbox above. Without it the row would be stamped
 * with the real company on sign-in and pushed with a parent id the server has
 * never seen — a foreign-key rejection that repeats on every drain and wedges
 * that table forever, which is the failure this codebase has already paid for
 * twice. It is also just correct: a row cannot live under a different tenant
 * from its parent.
 *
 * Returns undefined when the parent is unknown, leaving writeRow to stamp the
 * acting company exactly as before.
 */
async function parentCompanyId<T extends { company_id?: string }>(
  table: Table<T, string>,
  parentId: string
): Promise<string | undefined> {
  return (await table.get(parentId))?.company_id;
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
    company_id: await parentCompanyId(db.projects, input.project_id),
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
  const rows = await db.floors.where("project_id").equals(projectId).filter((f) => !f.deleted).toArray();
  // Natural order ("Level 2" before "Level 10") everywhere floors are listed;
  // Dexie returns them by creation, which put a duplicated floor on top.
  return rows.sort((a, b) => compareFloorLabels(a.label, b.label));
}

export async function getFloor(id: string): Promise<Floor | undefined> {
  return db.floors.get(id);
}

/**
 * Copy a floor's defaults, units and measurements onto a new floor. Towers
 * repeat; typing 115 windows twice is the thing this saves. Install state,
 * notes, photos, issues and check acknowledgements are NOT copied: they are
 * history of the source floor, not facts about the new one. Goes through the
 * normal create helpers so every row syncs and inherits the company.
 */
export async function duplicateFloor(sourceFloorId: string, newLabel: string): Promise<Floor> {
  const source = await db.floors.get(sourceFloorId);
  if (!source) throw new Error(`Floor ${sourceFloorId} not found`);
  const floor = await createFloor({
    project_id: source.project_id,
    label: newLabel,
    defaults: { ...source.defaults },
  });
  const units = (await listUnits(sourceFloorId)).sort((a, b) => a.sort_order - b.sort_order);
  for (const u of units) {
    const unit = await createUnit({
      floor_id: floor.id,
      number: carryUnitNumber(u.number, source.label, newLabel),
      status: u.status === "na" ? "na" : "active",
      sort_order: u.sort_order,
    });
    const windows = (await listWindows(u.id)).sort((a, b) => a.sort_order - b.sort_order);
    for (const w of windows) {
      await createWindow({
        unit_id: unit.id,
        tag_base: w.tag_base,
        tag_index: w.tag_index,
        widths: [...w.widths],
        height: w.height,
        quantity: w.quantity ?? 1,
        control_override: w.control_override,
        mount_override: w.mount_override,
        panel_controls: w.panel_controls ?? null,
        checks_ack: false,
        tight_override: w.tight_override ?? null,
        chain_length: w.chain_length ?? null,
        motorized_override: w.motorized_override ?? null,
        deduct: w.deduct,
        longer_chain: w.longer_chain,
        note: w.note,
        sort_order: w.sort_order,
      });
    }
  }
  return floor;
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
    company_id: await parentCompanyId(db.floors, input.floor_id),
    ...input,
    note: input.note ?? "",
    install: input.install ?? null,
    install_blocked: input.install_blocked ?? false,
    removed: input.removed ?? 0,
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

/**
 * Soft-delete a unit AND everything hanging off it. Children are tombstoned
 * through the same funnel so the other phone drops them too; leaving them
 * live under a deleted parent is invisible in the UI (every reader walks
 * units first) but it is exactly the kind of orphan a later feature trips
 * on. Deficiencies are left alone: a PM's complaint is a record of what
 * they said, not a child of our data model.
 */
export async function deleteUnit(id: string): Promise<void> {
  const existing = await db.units.get(id);
  if (!existing) return;
  const [windows, photos] = await Promise.all([
    db.windows.where("unit_id").equals(id).filter((w) => !w.deleted).toArray(),
    db.photos.where("unit_id").equals(id).filter((ph) => !ph.deleted).toArray(),
  ]);
  for (const w of windows) await writeRow(db.windows, "windows", { ...w, deleted: true }, "delete");
  for (const ph of photos) await writeRow(db.photos, "photos", { ...ph, deleted: true }, "delete");
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

/**
 * Keep the legacy tight boolean in step with measure_override.
 *
 * measure_override superseded tight_override in 2026-09 because a boolean
 * could not say "finished". A phone still on an older bundle reads only the
 * boolean, so every write derives it here — in the funnel rather than at each
 * call site, which is how the create-with-tag path and the autosave path came
 * to disagree the first time this was wired.
 *
 * "finished" has no boolean form; it leaves the legacy field null, so an old
 * bundle shows that window as following its floor rather than as something
 * wrong.
 */
function withLegacyTight<T extends Pick<WindowRecord, "measure_override" | "tight_override">>(
  w: T
): T {
  if (w.measure_override === undefined) return w;
  return {
    ...w,
    tight_override:
      w.measure_override === "tight" ? true : w.measure_override === "none" ? false : null,
  };
}

export async function createWindow(
  input: Omit<WindowRecord, "id" | "updated_at" | "deleted" | "quantity"> & {
    quantity?: number;
  }
): Promise<WindowRecord> {
  return writeRow(db.windows, "windows", {
    company_id: await parentCompanyId(db.units, input.unit_id),
    ...withLegacyTight(input),
    quantity: input.quantity ?? 1,
    panel_controls: input.panel_controls ?? null,
    checks_ack: input.checks_ack ?? false,
    tight_override: input.tight_override ?? null,
    chain_length: input.chain_length ?? null,
    motorized_override: input.motorized_override ?? null,
    issue_note: input.issue_note ?? "",
    issue_fault: input.issue_fault ?? null,
    issue_recut: input.issue_recut ?? false,
    issue_fixed_at: input.issue_fixed_at ?? null,
    issue_fix_note: input.issue_fix_note ?? "",
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
    company_id: await parentCompanyId(db.units, window.unit_id),
    ...withLegacyTight(window),
    updated_at: window.updated_at ?? "",
  } as WindowRecord);
}

export async function deleteWindow(id: string): Promise<void> {
  const existing = await db.windows.get(id);
  if (!existing) return;
  await writeRow(db.windows, "windows", { ...existing, deleted: true }, "delete");
}

/**
 * Repair invariants on a window as it leaves the store, so no consumer ever
 * sees a malformed row: panel_controls is parallel to widths, but rows
 * written before the removePanel fix (2026-08-20) can carry extra entries
 * from removed panels — and those entries silently shift a control onto the
 * wrong panel anywhere the row is read.
 */
function normalizeWindow(w: WindowRecord): WindowRecord {
  if (w.panel_controls && w.panel_controls.length > w.widths.length) {
    return { ...w, panel_controls: w.panel_controls.slice(0, w.widths.length) };
  }
  return w;
}

export async function listWindows(unitId: string): Promise<WindowRecord[]> {
  const rows = await db.windows.where("unit_id").equals(unitId).filter((w) => !w.deleted).toArray();
  return rows.map(normalizeWindow);
}

export async function getWindow(id: string): Promise<WindowRecord | undefined> {
  const row = await db.windows.get(id);
  return row ? normalizeWindow(row) : undefined;
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
// Acting company (see lib/tenant.ts for why the cache lives outside this file)
// ---------------------------------------------------------------------------

const COMPANY_KEY = "tenant:companyId";

/** Load the persisted company into the in-memory cache. Call before writes. */
export async function primeCompanyId(): Promise<string | null> {
  const row = await db.meta.get(COMPANY_KEY);
  const id = (row?.value as string | undefined) ?? null;
  setCompanyIdCache(id);
  return id;
}

/** Remember the company this device acts as, across reloads and offline. */
export async function persistCompanyId(companyId: string): Promise<void> {
  setCompanyIdCache(companyId);
  await db.meta.put({ key: COMPANY_KEY, value: companyId });
}

/**
 * Sign-out, or a membership that no longer resolves. Clears the id so nothing
 * can be written under a company this device no longer belongs to.
 */
export async function clearCompanyId(): Promise<void> {
  setCompanyIdCache(null);
  await db.meta.delete(COMPANY_KEY);
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
    company_id: await parentCompanyId(db.units, input.unit_id),
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
    company_id: await parentCompanyId(db.floors, input.floor_id),
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

/**
 * The most recent export of a floor, or undefined if it has never been
 * exported. Walks the [floor_id+exported_at] index backwards, so it touches
 * one live record instead of deserializing every stored snapshot — a floor
 * exported after each of 25 site visits holds ~1MB of history.
 */
export async function latestExport(floorId: string): Promise<ExportRecord | undefined> {
  let found: ExportRecord | undefined;
  await db.exports
    .where("[floor_id+exported_at]")
    .between([floorId, Dexie.minKey], [floorId, Dexie.maxKey])
    .reverse()
    .until(() => found !== undefined)
    .each((row) => {
      if (!row.deleted) found = row;
    });
  return found;
}

export async function deleteExportRecord(id: string): Promise<void> {
  const existing = await db.exports.get(id);
  if (!existing) return;
  await writeRow(db.exports, "exports", { ...existing, deleted: true }, "delete");
}

// ---------------------------------------------------------------------------
// Invoices
// ---------------------------------------------------------------------------

/**
 * Invoices are stored snapshots, not views (see the invoicing spec), so these
 * helpers deliberately never recompute a total: whatever the editor worked out
 * is what gets written, and whatever was written is what prints.
 */
export async function createInvoice(
  fields: Omit<InvoiceRecord, "id" | "updated_at" | "deleted">
): Promise<InvoiceRecord> {
  return writeRow(db.invoices, "invoices", {
    company_id: await parentCompanyId(db.projects, fields.project_id),
    ...fields,
    id: newId(),
    updated_at: new Date().toISOString(),
    deleted: false,
  });
}

/**
 * Write the whole invoice as the editor holds it.
 *
 * Deliberately NOT a read-modify-write patch: the editor autosaves on every
 * keystroke, and two patches issued a few milliseconds apart both read the
 * pre-edit row, so the second one writes back the first one's field unchanged
 * and silently reverts it. (Renaming an invoice and then editing its bill-to
 * did exactly that.) The window screen already writes whole rows through
 * upsertWindow for this reason; an invoice follows the same rule.
 */
export async function saveInvoice(invoice: InvoiceRecord): Promise<InvoiceRecord> {
  return writeRow(db.invoices, "invoices", invoice);
}

export async function deleteInvoice(id: string): Promise<void> {
  const existing = await db.invoices.get(id);
  if (!existing) return;
  await writeRow(db.invoices, "invoices", { ...existing, deleted: true }, "delete");
}

export async function getInvoice(id: string): Promise<InvoiceRecord | undefined> {
  const row = await db.invoices.get(id);
  return row && !row.deleted ? row : undefined;
}

/** Newest first — an invoices list is read from the top. */
export async function listInvoices(projectId: string): Promise<InvoiceRecord[]> {
  const rows = await db.invoices.where("project_id").equals(projectId).toArray();
  return rows
    .filter((r) => !r.deleted)
    .sort((a, b) => b.issue_date.localeCompare(a.issue_date) || b.updated_at.localeCompare(a.updated_at));
}

/**
 * Every invoice the company holds. The numbering series is company-wide, not
 * per project, so a new draft on one job has to see the numbers used on all
 * the others.
 */
export async function listAllInvoices(): Promise<InvoiceRecord[]> {
  const rows = await db.invoices.toArray();
  return rows
    .filter((r) => !r.deleted)
    .sort((a, b) => b.issue_date.localeCompare(a.issue_date) || b.updated_at.localeCompare(a.updated_at));
}

// ---------------------------------------------------------------------------
// PM share links and deficiencies
// ---------------------------------------------------------------------------

/** 32 random bytes, URL-safe. The link IS the authorisation, so it is long. */
export function newShareToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let out = "";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out;
}

export async function createProjectShare(projectId: string, label: string): Promise<ProjectShare> {
  return writeRow(db.project_shares, "project_shares", {
    company_id: await parentCompanyId(db.projects, projectId),
    id: newId(),
    updated_at: "",
    deleted: false,
    project_id: projectId,
    token: newShareToken(),
    label,
    revoked_at: null,
    last_used_at: null,
  });
}

export async function revokeProjectShare(id: string): Promise<void> {
  const existing = await db.project_shares.get(id);
  if (!existing) return;
  await writeRow(db.project_shares, "project_shares", {
    ...existing,
    revoked_at: new Date().toISOString(),
  });
}

export async function listProjectShares(projectId: string): Promise<ProjectShare[]> {
  const rows = await db.project_shares.where("project_id").equals(projectId).toArray();
  return rows.filter((r) => !r.deleted).sort((a, b) => a.updated_at.localeCompare(b.updated_at));
}

export async function listDeficiencies(projectId: string): Promise<Deficiency[]> {
  const rows = await db.deficiencies.where("project_id").equals(projectId).toArray();
  return rows.filter((r) => !r.deleted).sort((a, b) => b.raised_at.localeCompare(a.raised_at));
}

export async function listAllDeficiencies(): Promise<Deficiency[]> {
  const rows = await db.deficiencies.toArray();
  return rows.filter((r) => !r.deleted);
}

export async function setDeficiencyStatus(id: string, status: Deficiency["status"]): Promise<void> {
  const existing = await db.deficiencies.get(id);
  if (!existing) return;
  if (status === "resolved") await resolveIssue(id, existing.fix_note ?? "");
  else await reopenIssue(id);
}

// ---------------------------------------------------------------------------
// Site trips
// ---------------------------------------------------------------------------

export async function createTrip(
  input: Omit<Trip, "id" | "updated_at" | "deleted" | "billable" | "note"> & {
    billable?: boolean;
    note?: string;
  }
): Promise<Trip> {
  return writeRow(db.trips, "trips", {
    id: newId(),
    project_id: input.project_id,
    date: input.date,
    purpose: input.purpose,
    billable: input.billable ?? true,
    note: input.note ?? "",
    company_id: await parentCompanyId(db.projects, input.project_id),
    updated_at: "",
    deleted: false,
  });
}

export async function updateTrip(id: string, patch: Partial<Omit<Trip, "id">>): Promise<Trip | undefined> {
  const existing = await db.trips.get(id);
  if (!existing) return undefined;
  return writeRow(db.trips, "trips", { ...existing, ...patch });
}

export async function deleteTrip(id: string): Promise<void> {
  const existing = await db.trips.get(id);
  if (!existing) return;
  await writeRow(db.trips, "trips", { ...existing, deleted: true }, "delete");
}

/** A project's trips, newest first — the order they are read and logged in. */
export async function listTrips(projectId: string): Promise<Trip[]> {
  const rows = await db.trips.where("project_id").equals(projectId).toArray();
  return rows
    .filter((r) => !r.deleted)
    .sort((a, b) => b.date.localeCompare(a.date) || b.updated_at.localeCompare(a.updated_at));
}

// ---------------------------------------------------------------------------
// Deficiency fix batches
// ---------------------------------------------------------------------------

export async function createFixBatch(
  input: Pick<FixBatch, "project_id" | "name" | "floor_ids" | "rate_cents">,
  items: Array<Omit<FixItem, "id" | "updated_at" | "deleted" | "batch_id" | "project_id">>
): Promise<FixBatch> {
  const companyId = await parentCompanyId(db.projects, input.project_id);
  const batch = await writeRow(db.fix_batches, "fix_batches", {
    ...input,
    id: newId(),
    created_at: new Date().toISOString(),
    company_id: companyId,
    updated_at: "",
    deleted: false,
  });
  await addFixItems(batch, items);
  return batch;
}

export async function addFixItems(
  batch: FixBatch,
  items: Array<Omit<FixItem, "id" | "updated_at" | "deleted" | "batch_id" | "project_id">>
): Promise<void> {
  for (const item of items) {
    await writeRow(db.fix_items, "fix_items", {
      ...item,
      id: newId(),
      batch_id: batch.id,
      project_id: batch.project_id,
      company_id: batch.company_id,
      updated_at: "",
      deleted: false,
    });
  }
}

export async function updateFixBatch(id: string, patch: Partial<Omit<FixBatch, "id">>): Promise<FixBatch | undefined> {
  const existing = await db.fix_batches.get(id);
  if (!existing) return undefined;
  return writeRow(db.fix_batches, "fix_batches", { ...existing, ...patch });
}

export async function deleteFixBatch(id: string): Promise<void> {
  const existing = await db.fix_batches.get(id);
  if (!existing) return;
  for (const item of await listFixItems(id)) {
    await writeRow(db.fix_items, "fix_items", { ...item, deleted: true }, "delete");
  }
  await writeRow(db.fix_batches, "fix_batches", { ...existing, deleted: true }, "delete");
}

export async function getFixBatch(id: string): Promise<FixBatch | undefined> {
  const row = await db.fix_batches.get(id);
  return row && !row.deleted ? row : undefined;
}

/** A project's fix batches, newest first. */
export async function listFixBatches(projectId: string): Promise<FixBatch[]> {
  const rows = await db.fix_batches.where("project_id").equals(projectId).toArray();
  return rows.filter((r) => !r.deleted).sort((a, b) => b.created_at.localeCompare(a.created_at));
}

/** Every item in a batch, in the order it was gathered (floor, unit, blind). */
export async function listFixItems(batchId: string): Promise<FixItem[]> {
  const rows = await db.fix_items.where("batch_id").equals(batchId).toArray();
  return rows.filter((r) => !r.deleted).sort((a, b) => a.sort_order - b.sort_order);
}

export async function listProjectFixItems(projectId: string): Promise<FixItem[]> {
  const rows = await db.fix_items.where("project_id").equals(projectId).toArray();
  return rows.filter((r) => !r.deleted);
}

// ---------------------------------------------------------------------------
// Problems on units and blinds (deficiencies, crew- or PM-raised)
// ---------------------------------------------------------------------------

/** Record a problem on a blind (or the unit, with no window). */
export async function createIssue(input: {
  project_id: string;
  unit_id: string;
  window_id: string | null;
  note: string;
  fault?: Deficiency["fault"];
  recut?: boolean;
}): Promise<Deficiency> {
  return writeRow(db.deficiencies, "deficiencies", {
    id: newId(),
    company_id: await parentCompanyId(db.units, input.unit_id),
    updated_at: "",
    deleted: false,
    project_id: input.project_id,
    unit_id: input.unit_id,
    window_id: input.window_id,
    share_id: null,
    note: input.note,
    raised_by: CREW,
    raised_at: new Date().toISOString(),
    status: "open",
    resolved_at: null,
    fault: input.fault ?? null,
    recut: input.recut ?? false,
    fix_note: "",
  });
}

/** Write the whole row as the screen holds it (see saveInvoice for why). */
export async function saveIssue(d: Deficiency): Promise<Deficiency> {
  return writeRow(db.deficiencies, "deficiencies", d);
}

/** Entered by mistake: gone, not fixed. */
export async function removeIssue(id: string): Promise<void> {
  const existing = await db.deficiencies.get(id);
  if (!existing) return;
  await writeRow(db.deficiencies, "deficiencies", { ...existing, deleted: true }, "delete");
  await unblockIfClear(existing.unit_id);
}

/** Open problems on a unit: deficiencies, plus any old-style window issue. */
async function unitHasOpen(unitId: string, exceptId?: string): Promise<boolean> {
  const defs = await db.deficiencies.where("unit_id").equals(unitId).toArray();
  if (defs.some((d) => d.id !== exceptId && deficiencyOpen(d))) return true;
  return (await listWindows(unitId)).some((w) => legacyIssueOpen(w));
}

/** Take a unit off ⚠ blocked once nothing in it is still open. */
async function unblockIfClear(unitId: string): Promise<void> {
  const unit = await db.units.get(unitId);
  if (unit && !unit.deleted && unit.install_blocked && !(await unitHasOpen(unitId))) {
    await updateUnit(unitId, { install_blocked: false });
  }
}

/**
 * Mark one problem fixed, keeping it as the record with when and what was
 * done. The unit comes off ⚠ blocked once nothing else in it is open, and an
 * open fix-batch entry for the same problem is ticked off with it so the
 * batch and the unit screen never disagree.
 */
export async function resolveIssue(
  id: string,
  fixNote: string,
  opts: { at?: string; fromBatch?: boolean } = {}
): Promise<void> {
  const d = await db.deficiencies.get(id);
  if (!d || d.deleted) return;
  const at = opts.at ?? d.resolved_at ?? new Date().toISOString();
  await writeRow(db.deficiencies, "deficiencies", { ...d, status: "resolved", resolved_at: at, fix_note: fixNote });
  await unblockIfClear(d.unit_id);
  if (!opts.fromBatch) {
    const items = await db.fix_items.filter((i) => i.deficiency_id === id && !i.deleted && i.status === "open").toArray();
    for (const i of items) {
      await writeRow(db.fix_items, "fix_items", { ...i, status: "fixed", fixed_at: at, fix_note: fixNote || i.fix_note });
    }
  }
}

/** Not fixed after all: open again, and the unit re-blocked if asked. */
export async function reopenIssue(id: string, opts: { reblock?: boolean; fromBatch?: boolean } = {}): Promise<void> {
  const d = await db.deficiencies.get(id);
  if (!d || d.deleted) return;
  await writeRow(db.deficiencies, "deficiencies", { ...d, status: "open", resolved_at: null });
  if (opts.reblock) {
    const unit = await db.units.get(d.unit_id);
    if (unit && !unit.deleted && !unit.install_blocked) await updateUnit(unit.id, { install_blocked: true });
  }
  if (!opts.fromBatch) {
    const items = await db.fix_items.filter((i) => i.deficiency_id === id && !i.deleted && i.status === "fixed").toArray();
    for (const i of items) await writeRow(db.fix_items, "fix_items", { ...i, status: "open", fixed_at: null });
  }
}

/** Keep a fixed problem's "what was done" in step with its batch entry. */
export async function setIssueFixNote(id: string, note: string): Promise<void> {
  const d = await db.deficiencies.get(id);
  if (!d || d.deleted) return;
  await writeRow(db.deficiencies, "deficiencies", { ...d, fix_note: note });
}

/**
 * Move problems still held in a window's old single-issue fields into
 * deficiency rows, then empty those fields. Runs after every sync, so a
 * phone still on an older version that flags a blind the old way has it
 * picked up by the next phone that syncs. The row's id comes from the issue
 * itself (legacyIssueId), so two phones moving the same one write one row.
 */
export async function adoptLegacyIssues(): Promise<number> {
  const windows = await db.windows.filter((w) => !w.deleted && hasLegacyIssue(w)).toArray();
  let moved = 0;
  for (const w of windows) {
    const unit = await db.units.get(w.unit_id);
    const floor = unit ? await db.floors.get(unit.floor_id) : undefined;
    if (!unit || !floor) continue;
    const id = await legacyIssueId(w);
    if (!(await db.deficiencies.get(id))) {
      const fixedAt = w.issue_fixed_at ?? null;
      await writeRow(db.deficiencies, "deficiencies", {
        id,
        company_id: w.company_id ?? unit.company_id,
        updated_at: "",
        deleted: false,
        project_id: floor.project_id,
        unit_id: unit.id,
        window_id: w.id,
        share_id: null,
        note: w.issue_note ?? "",
        raised_by: CREW,
        raised_at: w.updated_at,
        status: fixedAt ? "resolved" : "open",
        resolved_at: fixedAt,
        fault: w.issue_fault ?? null,
        recut: w.issue_recut === true,
        fix_note: w.issue_fix_note ?? "",
      });
    }
    const items = await db.fix_items.filter((i) => i.window_id === w.id && !i.deleted && !i.deficiency_id).toArray();
    for (const i of items) await writeRow(db.fix_items, "fix_items", { ...i, deficiency_id: id });
    await upsertWindow({
      ...w,
      issue_note: "",
      issue_fault: null,
      issue_recut: false,
      issue_fixed_at: null,
      issue_fix_note: "",
    });
    moved++;
  }
  return moved;
}

/**
 * Move a fix between to-do, fixed and can't-fix, keeping its deficiency in
 * step: ✓ Fixed marks that one problem fixed (kept as the record — see
 * resolveIssue); undoing it opens it again and re-blocks the unit if it was
 * blocked when the batch was made.
 */
export async function setFixStatus(item: FixItem, status: FixItem["status"]): Promise<FixItem> {
  const fixedAt = status === "fixed" ? item.fixed_at ?? new Date().toISOString() : null;
  const saved = await writeRow(db.fix_items, "fix_items", { ...item, status, fixed_at: fixedAt });
  if (!item.deficiency_id) return saved;
  if (status === "fixed") {
    await resolveIssue(item.deficiency_id, item.fix_note, { at: fixedAt ?? undefined, fromBatch: true });
  } else if (item.status === "fixed") {
    await reopenIssue(item.deficiency_id, { reblock: item.unit_was_blocked, fromBatch: true });
  }
  return saved;
}

/**
 * Floors with their units, blinds and problems, ready for gatherFixItems.
 * Moves any old-style window issue into a problem entry first so it is
 * gathered like the rest.
 */
export async function loadFixGather(
  projectId: string,
  floorIds?: string[]
): Promise<Array<{ floor: Floor; gather: { id: string; units: Array<{ unit: Unit; windows: WindowRecord[]; deficiencies: Deficiency[] }> } }>> {
  await adoptLegacyIssues().catch(() => 0);
  const defs = await listDeficiencies(projectId);
  const floors = (await listFloors(projectId)).filter((f) => !floorIds || floorIds.includes(f.id));
  const out = [];
  for (const floor of floors) {
    const units = [];
    for (const unit of await listUnits(floor.id)) {
      units.push({ unit, windows: await listWindows(unit.id), deficiencies: defs.filter((d) => d.unit_id === unit.id) });
    }
    out.push({ floor, gather: { id: floor.id, units } });
  }
  return out;
}

/** Write the whole item as the screen holds it (see saveInvoice for why). */
export async function saveFixItem(item: FixItem): Promise<FixItem> {
  return writeRow(db.fix_items, "fix_items", item);
}

// ---------------------------------------------------------------------------
// Company and members
// ---------------------------------------------------------------------------

/**
 * The acting company id, priming from meta if the in-memory cache is cold.
 *
 * start() primes at boot, but that is async and a direct navigation to a
 * data-dependent screen can beat it — which rendered "no company on this
 * device" for a device that plainly had one. Reads resolve; only the write
 * funnel uses the synchronous cache (a measurement tap must not await, and
 * normalizeForPush backfills anything written before priming).
 */
async function resolveCompanyId(): Promise<string | null> {
  return getCompanyIdSync() ?? (await primeCompanyId());
}

/** The acting company's row, or undefined before the first sync brings it in. */
export async function getCompany(): Promise<Company | undefined> {
  const id = await resolveCompanyId();
  if (!id) return undefined;
  const row = await db.companies.get(id);
  return row && !row.deleted ? row : undefined;
}

export async function updateCompany(patch: Partial<Omit<Company, "id">>): Promise<Company> {
  const id = await resolveCompanyId();
  if (!id) throw new Error("No acting company");
  const existing = await db.companies.get(id);
  if (!existing) throw new Error("Company not loaded yet");
  return writeRow(db.companies, "companies", { ...existing, ...patch });
}

/** The acting company's roster, invited members included. */
export async function listMembers(): Promise<Membership[]> {
  const id = await resolveCompanyId();
  if (!id) return [];
  const rows = await db.memberships.where("company_id").equals(id).toArray();
  return rows
    .filter((m) => !m.deleted)
    .sort((a, b) => a.email.localeCompare(b.email));
}

/**
 * Invite someone by email. Creates a pending membership; their first code
 * sign-in activates it. Emails are lowercased because GoTrue lowercases the
 * address in the JWT, and a capital letter once locked Mike out entirely.
 */
export async function inviteMember(email: string, role: Membership["role"] = "member"): Promise<Membership> {
  const company_id = await resolveCompanyId();
  if (!company_id) throw new Error("No acting company");
  return writeRow(db.memberships, "memberships", {
    id: newId(),
    updated_at: "",
    deleted: false,
    company_id,
    user_id: null,
    email: email.trim().toLowerCase(),
    role,
    status: "invited",
  });
}

/** Remove someone. Soft delete, so the row syncs and the server locks them out. */
export async function removeMember(id: string): Promise<void> {
  const existing = await db.memberships.get(id);
  if (!existing) return;
  await writeRow(db.memberships, "memberships", { ...existing, deleted: true }, "delete");
}

export async function setMemberRole(id: string, role: Membership["role"]): Promise<void> {
  const existing = await db.memberships.get(id);
  if (!existing) return;
  await writeRow(db.memberships, "memberships", { ...existing, role });
}
