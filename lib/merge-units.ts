// Repair for the one silent concurrent-crew failure: two phones, apart or
// offline, each create the same unit number on a floor (the duplicate check
// can only see its own device), and after sync the floor shows two "405"
// tiles, each holding whichever windows its creator measured. Nothing is
// wrong with either tile's data — they just need to become one unit.
//
// The merge is loss-free by construction: every window and photo from the
// dropped unit moves onto the kept one; nothing is chosen between, so there
// is no version-picker to get wrong on a ladder.
import {
  db,
  deleteUnit,
  listPhotos,
  listWindows,
  updateUnit,
  upsertWindow,
} from "./db";
import { syncUnitTagIndices } from "@/components/window-tags";
import type { Unit } from "./types";

/** Duplicate unit numbers on a floor: trimmed number -> the units sharing it. */
export function findDuplicateUnitNumbers(units: Pick<Unit, "id" | "number">[]): Map<string, string[]> {
  const byNumber = new Map<string, string[]>();
  for (const u of units) {
    const key = u.number.trim();
    if (!key) continue;
    byNumber.set(key, [...(byNumber.get(key) ?? []), u.id]);
  }
  return new Map([...byNumber].filter(([, ids]) => ids.length > 1));
}

/**
 * The pure half of the merge, separated so it can be tested without
 * IndexedDB: given both units, decide the kept unit's merged fields.
 *
 * - note: both notes survive, joined — a punch-list line must never vanish
 *   in a repair step.
 * - status: "done" only when BOTH crews had finished their half; anything
 *   else drops back to "active" so the combined unit gets looked at again.
 * - install: the least-finished state wins (null < staged < done) for the
 *   same reason; a blocked flag on either side survives, since blocked
 *   requires a note and that note is being carried over.
 */
export function planUnitMerge(keep: Unit, drop: Unit): Partial<Unit> {
  const notes = [keep.note, drop.note].map((n) => n.trim()).filter(Boolean);
  const INSTALL_RANK = { null: 0, staged: 1, done: 2 } as const;
  const rank = (v: Unit["install"]) => INSTALL_RANK[String(v) as keyof typeof INSTALL_RANK];
  return {
    note: [...new Set(notes)].join(" / "),
    status: keep.status === "done" && drop.status === "done" ? "done" : "active",
    install: rank(keep.install) <= rank(drop.install) ? keep.install : drop.install,
    install_blocked: keep.install_blocked || drop.install_blocked,
  };
}

/**
 * Move everything from `dropId` onto `keepId`, then soft-delete the empty
 * duplicate. All writes go through the normal helpers, so each carries an
 * outbox entry and the repair syncs to the other phone like any other edit.
 */
export async function mergeUnits(keepId: string, dropId: string): Promise<void> {
  const [keep, drop] = await Promise.all([db.units.get(keepId), db.units.get(dropId)]);
  if (!keep || !drop || keep.deleted || drop.deleted) return;

  const [keepWindows, dropWindows, dropPhotos] = await Promise.all([
    listWindows(keepId),
    listWindows(dropId),
    listPhotos(dropId),
  ]);

  // Dropped windows land after the kept unit's, preserving each crew's own
  // entry order within its half.
  let sort = keepWindows.reduce((max, w) => Math.max(max, w.sort_order), -1) + 1;
  for (const w of dropWindows) {
    await upsertWindow({ ...w, unit_id: keepId, sort_order: sort++ });
  }
  for (const ph of dropPhotos) {
    await db.transaction("rw", db.photos, db.outbox, async () => {
      const at = new Date().toISOString();
      await db.photos.put({ ...ph, unit_id: keepId, updated_at: at });
      await db.outbox.add({ table: "photos", rowId: ph.id, op: "put", at });
    });
  }

  await updateUnit(keepId, planUnitMerge(keep, drop));
  await deleteUnit(dropId);
  // Two crews both measured an LR: the combined unit now holds LR twice, and
  // the retro-numbering that turns them into LR1/LR2 must run here.
  await syncUnitTagIndices(keepId);
}
