"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { seedIfNeeded } from "@/lib/seed";
import { db, listProjects } from "@/lib/db";
import { windowBlindCount } from "@/lib/export/shared";
import type { Project } from "@/lib/types";
import { JobCard, type FloorProgress } from "@/components/job-card";
import { SyncStatus } from "@/components/sync-status";
import { blockedOf, installOf } from "@/components/status";

interface ProjectRow {
  project: Project;
  floors: FloorProgress[];
}

export default function Home() {
  const [rows, setRows] = useState<ProjectRow[] | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      await seedIfNeeded();
      // Four bulk reads and in-memory grouping. The obvious per-project /
      // per-floor / per-unit queries are ~100 sequential IndexedDB round
      // trips on today's data and grow with every job — noticeable on a
      // phone, and the dashboard is the screen that opens most.
      const [projects, allFloors, allUnits, allWindows] = await Promise.all([
        listProjects(),
        db.floors.filter((f) => !f.deleted).toArray(),
        db.units.filter((u) => !u.deleted).toArray(),
        db.windows.filter((w) => !w.deleted).toArray(),
      ]);

      const floorsByProject = new Map<string, typeof allFloors>();
      for (const f of allFloors) {
        const list = floorsByProject.get(f.project_id) ?? [];
        list.push(f);
        floorsByProject.set(f.project_id, list);
      }
      const unitsByFloor = new Map<string, typeof allUnits>();
      for (const u of allUnits) {
        const list = unitsByFloor.get(u.floor_id) ?? [];
        list.push(u);
        unitsByFloor.set(u.floor_id, list);
      }
      const blindsByUnit = new Map<string, number>();
      for (const w of allWindows) {
        blindsByUnit.set(w.unit_id, (blindsByUnit.get(w.unit_id) ?? 0) + windowBlindCount(w));
      }

      const nextRows: ProjectRow[] = projects.map((project) => {
        const floorProgress: FloorProgress[] = (floorsByProject.get(project.id) ?? []).map(
          (floor) => {
            const relevant = (unitsByFloor.get(floor.id) ?? []).filter((u) => u.status !== "na");
            let blinds = 0;
            let installStaged = 0;
            let installDone = 0;
            let installBlocked = 0;
            for (const unit of relevant) {
              blinds += blindsByUnit.get(unit.id) ?? 0;
              if (blockedOf(unit)) installBlocked++;
              else if (installOf(unit) === "staged") installStaged++;
              else if (installOf(unit) === "done") installDone++;
            }
            const hasInstallActivity = installStaged + installDone + installBlocked > 0;
            return {
              id: floor.id,
              label: floor.label,
              done: relevant.filter((u) => u.status === "done").length,
              total: relevant.length,
              blinds,
              install: hasInstallActivity
                ? { staged: installStaged, done: installDone, blocked: installBlocked }
                : null,
            };
          }
        );
        return { project, floors: floorProgress };
      });

      if (!cancelled) setRows(nextRows);
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="flex flex-1 flex-col gap-4 p-4 pb-24">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Measure</h1>
        <div className="flex items-center gap-3">
          <SyncStatus />
          <Link
            href="/help"
            aria-label="How to use Measure"
            className="flex h-8 w-8 items-center justify-center rounded-full border border-neutral-300 text-sm font-semibold text-neutral-500 dark:border-neutral-700 dark:text-neutral-400"
          >
            ?
          </Link>
        </div>
      </header>

      {rows === null && <div className="text-sm text-neutral-500">Loading…</div>}

      {rows !== null && rows.length === 0 && (
        <div className="rounded-xl border border-dashed border-neutral-300 p-6 text-center text-sm text-neutral-500 dark:border-neutral-700">
          No jobs yet. Tap + New to start one.
        </div>
      )}

      <div className="flex flex-col gap-3">
        {rows?.map((row) => (
          <JobCard key={row.project.id} project={row.project} floors={row.floors} />
        ))}
      </div>

      <Link
        href="/new"
        className="fixed bottom-5 right-5 flex h-14 items-center gap-2 rounded-full bg-blue-600 px-5 text-white shadow-lg active:bg-blue-700"
      >
        <span className="text-xl leading-none">+</span>
        <span className="text-sm font-medium">New</span>
      </Link>
    </main>
  );
}
