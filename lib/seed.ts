import seedData from "@/fixtures/seed-projects.json";
import { createFloor, createProject, createUnit, createWindow, deleteFloor, deleteProject, deleteUnit, deleteWindow, getMeta, listFloors, listProjects, listUnits, listWindows, setMeta } from "./db";
import type { BuildingType, ControlOverride, Deduct, FloorDefaults, UnitStatus } from "./types";

const SEED_VERSION_KEY = "seed:version";
const SEED_PROJECT_IDS_KEY = "seed:projectIds";
/**
 * Bump this whenever fixtures/seed-projects.json gains a new PROJECT that
 * existing installs should pick up (e.g. Alcon 2665 Meadowpine added at
 * version 2). Each version's seed pass inserts only projects whose `name`
 * doesn't already exist locally — never touches or duplicates a project
 * that's already there, so Mitch/Mike's in-progress edits are safe.
 */
const CURRENT_SEED_VERSION = 3;

// The fixture JSON has the right shape but `resolveJsonModule` widens its
// literal fields (e.g. "residential" -> string). These local interfaces just
// describe what generate_seed.py actually produces so the loop below can
// cast narrow at the one place it matters (the lib/db.ts write calls).
interface SeedWindow {
  tag_base: string;
  tag_index: number;
  widths: number[];
  height: number;
  quantity?: number;
  control_override: string | null;
  deduct: string | null;
  longer_chain: boolean;
  note: string;
}

interface SeedUnit {
  number: string;
  status: string;
  windows: SeedWindow[];
}

interface SeedFloor {
  label: string;
  defaults: FloorDefaults;
  units: SeedUnit[];
}

interface SeedProject {
  name: string;
  address: string;
  building_type: string;
  tag_chips: string[];
  floors: SeedFloor[];
}

/**
 * Populate IndexedDB from fixtures/seed-projects.json so Mike sees the app
 * populated with real jobs (Arbour House L2 + L4, 44 Charles Batch 3, Alcon
 * 2665 Meadowpine) instead of an empty dashboard. Versioned via a meta
 * counter rather than a one-shot flag: an install that already seeded at an
 * older version re-runs this, but only *new* projects (by name) from the
 * fixture actually get inserted — existing projects (and any edits made to
 * them) are never touched or duplicated. Seeded rows are normal rows
 * afterward (editable, exportable, syncable) — see spec: Seed data.
 */
let seedInFlight: Promise<void> | null = null;

export function seedIfNeeded(): Promise<void> {
  // React dev-mode mounts effects twice; without a shared in-flight promise
  // both invocations pass the version check and seed everything twice.
  if (!seedInFlight) seedInFlight = doSeed();
  return seedInFlight;
}

async function doSeed(): Promise<void> {
  const storedVersion = (await getMeta<number>(SEED_VERSION_KEY)) ?? 0;
  if (storedVersion >= CURRENT_SEED_VERSION) return;

  const projects = (seedData as { projects: SeedProject[] }).projects;
  const existingNames = new Set((await listProjects()).map((p) => p.name));

  for (const project of projects) {
    if (existingNames.has(project.name)) continue;

    const p = await createProject({
      name: project.name,
      address: project.address,
      building_type: project.building_type as BuildingType,
      tag_chips: project.tag_chips,
    });
    const seededIds = (await getMeta<string[]>(SEED_PROJECT_IDS_KEY)) ?? [];
    await setMeta(SEED_PROJECT_IDS_KEY, [...seededIds, p.id]);

    for (const floor of project.floors) {
      const f = await createFloor({
        project_id: p.id,
        label: floor.label,
        defaults: floor.defaults,
      });

      let unitSortOrder = 0;
      for (const unit of floor.units) {
        const u = await createUnit({
          floor_id: f.id,
          number: unit.number,
          status: unit.status as UnitStatus,
          sort_order: unitSortOrder++,
        });

        let windowSortOrder = 0;
        for (const w of unit.windows) {
          await createWindow({
            unit_id: u.id,
            tag_base: w.tag_base,
            tag_index: w.tag_index,
            widths: w.widths,
            height: w.height,
            quantity: w.quantity ?? 1,
            control_override: w.control_override as ControlOverride,
            deduct: w.deduct as Deduct,
            longer_chain: w.longer_chain,
            note: w.note,
            sort_order: windowSortOrder++,
          });
        }
      }
    }
  }

  await setMeta(SEED_VERSION_KEY, CURRENT_SEED_VERSION);
}

/**
 * Seed-duplicate adoption (runs after every sync pull; see lib/sync).
 *
 * Every device seeds the example projects with its own random ids, so the
 * first sync from a second device would otherwise upload a second copy of
 * each example — that is exactly what produced triplicate projects on
 * 2026-08-15. When a pull brings in a same-name project with a different id
 * (the crew's canonical copy), this deletes the local seeded copy — but only
 * if it is still PURE seed data: no unit ever touched (install/blocked/note)
 * and no floor added beyond the fixture's. An edited copy is left alone for
 * a human to reconcile rather than risk losing field data.
 */
export async function adoptSeedDuplicates(): Promise<void> {
  const seededIds = (await getMeta<string[]>(SEED_PROJECT_IDS_KEY)) ?? [];
  if (seededIds.length === 0) return;

  const fixtureFloorLabels = new Map<string, Set<string>>();
  for (const project of (seedData as { projects: SeedProject[] }).projects) {
    fixtureFloorLabels.set(project.name, new Set(project.floors.map((f) => f.label)));
  }

  const all = await listProjects();
  for (const seededId of seededIds) {
    const mine = all.find((p) => p.id === seededId);
    if (!mine) continue;
    const canonical = all.find((p) => p.name === mine.name && p.id !== mine.id);
    if (!canonical) continue;

    const floors = await listFloors(mine.id);
    const allowedLabels = fixtureFloorLabels.get(mine.name) ?? new Set<string>();
    let pure = floors.every((f) => allowedLabels.has(f.label));
    if (pure) {
      outer: for (const f of floors) {
        for (const u of await listUnits(f.id)) {
          if ((u.install ?? null) !== null || u.install_blocked || (u.note ?? "") !== "") {
            pure = false;
            break outer;
          }
        }
      }
    }
    if (!pure) continue;

    for (const f of floors) {
      for (const u of await listUnits(f.id)) {
        for (const w of await listWindows(u.id)) await deleteWindow(w.id);
        await deleteUnit(u.id);
      }
      await deleteFloor(f.id);
    }
    await deleteProject(mine.id);
  }
}
