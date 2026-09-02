import Dexie, { type Table } from "dexie";
import type {
  Company,
  ExportRecord,
  Floor,
  InvoiceRecord,
  Membership,
  Project,
  Unit,
  UnitPhoto,
  WindowRecord,
} from "./types";
import { DEMO_COMPANY_ID, getCompanyIdSync, setCompanyIdCache } from "./tenant";

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
  | "invoices";
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
    company_id: await parentCompanyId(db.units, input.unit_id),
    ...input,
    quantity: input.quantity ?? 1,
    panel_controls: input.panel_controls ?? null,
    checks_ack: input.checks_ack ?? false,
    tight_override: input.tight_override ?? null,
    chain_length: input.chain_length ?? null,
    motorized_override: input.motorized_override ?? null,
    issue_note: input.issue_note ?? "",
    issue_fault: input.issue_fault ?? null,
    issue_recut: input.issue_recut ?? false,
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
    ...window,
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
