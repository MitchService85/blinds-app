"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { seedIfNeeded } from "@/lib/seed";
import { listFloors, listProjects, listUnits } from "@/lib/db";
import type { Project } from "@/lib/types";
import { JobCard, type FloorProgress } from "@/components/job-card";
import { SyncStatus } from "@/components/sync-status";

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
      const projects = await listProjects();
      const nextRows: ProjectRow[] = [];

      for (const project of projects) {
        const floors = await listFloors(project.id);
        const floorProgress: FloorProgress[] = [];
        for (const floor of floors) {
          const units = await listUnits(floor.id);
          const relevant = units.filter((u) => u.status !== "na");
          floorProgress.push({
            id: floor.id,
            label: floor.label,
            done: relevant.filter((u) => u.status === "done").length,
            total: relevant.length,
          });
        }
        nextRows.push({ project, floors: floorProgress });
      }

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
        <SyncStatus />
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
