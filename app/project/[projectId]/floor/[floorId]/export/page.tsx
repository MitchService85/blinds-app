"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { getFloor, getProject, listFloors, listUnits, listWindows } from "@/lib/db";
import type { Floor, Project, Unit, WindowRecord } from "@/lib/types";
import { BackButton } from "@/components/back-button";
import { ExportButton } from "@/components/export-button";
import { Icon } from "@/components/icon";
import { deliverFile } from "@/lib/export/deliver";
import { localDateISO } from "@/lib/export/build-input";
import { windowBlindCount } from "@/lib/export/shared";
import {
  buildDeficiencyRows,
  hasIssue,
  suggestedDeficiencyFilename,
  type DeficiencyFloor,
} from "@/lib/export/deficiencies";

interface FloorData {
  floor: Floor;
  units: Unit[];
  windowsByUnit: Map<string, WindowRecord[]>;
}

async function loadFloorData(floor: Floor): Promise<FloorData> {
  const units = await listUnits(floor.id);
  const windowsByUnit = new Map<string, WindowRecord[]>();
  await Promise.all(units.map(async (u) => windowsByUnit.set(u.id, await listWindows(u.id))));
  return { floor, units, windowsByUnit };
}

function toDeficiencyFloor(d: FloorData): DeficiencyFloor {
  return {
    label: d.floor.label,
    units: d.units
      .filter((u) => u.status !== "na")
      .map((u) => ({
        number: u.number,
        sort_order: u.sort_order,
        windows: (d.windowsByUnit.get(u.id) ?? []).map((w) => ({
          tag_base: w.tag_base,
          tag_index: w.tag_index,
          widths: w.widths,
          height: w.height,
          deduct: w.deduct,
          issue_note: w.issue_note ?? "",
          issue_fault: w.issue_fault ?? null,
          issue_recut: w.issue_recut ?? false,
          sort_order: w.sort_order,
        })),
      })),
  };
}

/**
 * Export options for a floor: the factory measure sheet (unchanged flow,
 * with its review and history) and the deficiency list, which can span
 * several floors because a walk-through usually covers more than one.
 */
export default function ExportPage() {
  const { projectId, floorId } = useParams<{ projectId: string; floorId: string }>();
  const [project, setProject] = useState<Project | null>(null);
  const [floors, setFloors] = useState<Floor[]>([]);
  const [data, setData] = useState<Map<string, FloorData>>(new Map());
  const [selected, setSelected] = useState<Set<string>>(new Set([floorId]));
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [p, f, all] = await Promise.all([getProject(projectId), getFloor(floorId), listFloors(projectId)]);
      if (cancelled || !p || !f) return;
      setProject(p);
      setFloors(all);
      const loaded = await Promise.all(all.map(loadFloorData));
      if (cancelled) return;
      setData(new Map(loaded.map((d) => [d.floor.id, d])));
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, floorId]);

  const current = data.get(floorId);

  const rows = useMemo(
    () =>
      buildDeficiencyRows(
        floors.filter((f) => selected.has(f.id)).map((f) => data.get(f.id)).filter((d): d is FloorData => !!d).map(toDeficiencyFloor)
      ),
    [floors, selected, data]
  );
  const assumed = rows.filter((r) => r.assumed).length;

  /** Every blind on a floor — the denominator for "29 of 74 flagged". */
  function blindCount(f: Floor): number {
    const d = data.get(f.id);
    if (!d) return 0;
    let n = 0;
    for (const u of d.units) {
      if (u.status === "na") continue;
      for (const w of d.windowsByUnit.get(u.id) ?? []) n += windowBlindCount(w);
    }
    return n;
  }

  function issueCount(f: Floor): number {
    const d = data.get(f.id);
    if (!d) return 0;
    let n = 0;
    for (const u of d.units) if (u.status !== "na") for (const w of d.windowsByUnit.get(u.id) ?? []) if (hasIssue({ issue_note: w.issue_note ?? "", issue_fault: w.issue_fault ?? null, issue_recut: w.issue_recut ?? false })) n++;
    return n;
  }

  async function exportDeficiencies() {
    if (!project || rows.length === 0 || busy) return;
    setBusy(true);
    try {
      const mod = await import("@/lib/export/deficiencies-xlsx");
      const labels = floors.filter((f) => selected.has(f.id)).map((f) => f.label);
      const date = localDateISO();
      // Says on the file what the file is. Flagged blinds only means a room
      // measured BR1/BR2/BR3 with notes on the outer two shows BR1 and BR3
      // and no BR2 — which reads as an export that dropped blinds, and was
      // reported as one (44 Charles Batch 5, 2026-10-06).
      const picked = floors.filter((f) => selected.has(f.id));
      const flagged = picked.reduce((n, f) => n + issueCount(f), 0);
      const total = picked.reduce((n, f) => n + blindCount(f), 0);
      const scope =
        `Flagged blinds only — ${flagged} of ${total} on ${labels.join(", ")}. ` +
        `Blinds with nothing wrong are left out, so tag numbers skip. ` +
        `This is not the factory measure sheet.`;
      const blob = await mod.deficienciesToBlob(
        rows,
        `${project.name} — deficiencies — ${labels.join(", ")} — ${date}`,
        scope
      );
      await deliverFile(blob, suggestedDeficiencyFilename(project.name, labels, date));
    } finally {
      setBusy(false);
    }
  }

  if (!project || !current) return <main className="p-4 text-sm text-neutral-500">Loading…</main>;

  return (
    <main className="flex flex-1 flex-col gap-6 p-4 pb-12">
      <header className="flex items-center gap-3">
        {/* The shared back arrow, like every other screen: press state on
            iOS, and a fixed destination. router.back() did nothing at all
            after a reload in the home-screen app, where there is no history
            to go back through. */}
        <BackButton href={`/project/${projectId}/floor/${floorId}`} label="Back to the floor" />
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-semibold">Export</h1>
          <div className="text-sm text-neutral-500">
            {project.name} · {current.floor.label}
          </div>
        </div>
      </header>

      <section className="rounded-xl border border-neutral-200 p-4 dark:border-neutral-800">
        <h2 className="font-semibold">Factory measure sheet</h2>
        <p className="mt-1 mb-3 text-sm text-neutral-500">
          <b>This is the file the factory builds from.</b> Every window on {current.floor.label} in
          their own format, one row per panel.
        </p>
        <div className="flex flex-wrap items-center justify-end gap-y-2">
          <ExportButton
            projectName={project.name}
            floor={current.floor}
            units={current.units}
            windowsByUnit={current.windowsByUnit}
          />
        </div>
      </section>

      <section className="rounded-xl border border-neutral-200 p-4 dark:border-neutral-800">
        <h2 className="font-semibold">Deficiency list</h2>
        <p className="mt-1 mb-3 text-sm text-neutral-500">
          <b>Flagged blinds only</b> — not a measure sheet. A blind with nothing wrong is left
          out, so the tags skip (BR1 and BR3 with no BR2). One row per panel, with a column for
          the PM to approve and one for the factory. Bay notes that say left or right land on
          that panel.
        </p>
        <div className="flex flex-col gap-1">
          {floors.map((f) => {
            const n = issueCount(f);
            return (
              <label key={f.id} className="flex min-h-11 items-center gap-3 rounded-lg px-1">
                <input
                  type="checkbox"
                  className="h-5 w-5"
                  checked={selected.has(f.id)}
                  onChange={(e) => {
                    const next = new Set(selected);
                    if (e.target.checked) next.add(f.id);
                    else next.delete(f.id);
                    setSelected(next);
                  }}
                />
                <span className="flex-1 text-sm">{f.label}</span>
                <span className="text-xs text-neutral-500">
                  {n === 0 ? "no issues" : `${n} blind${n === 1 ? "" : "s"}`}
                </span>
              </label>
            );
          })}
        </div>
        {assumed > 0 && (
          <div className="mt-3 flex items-start gap-2 rounded-lg bg-amber-50 p-2 text-xs text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
            <Icon name="alert" size={14} />
            <span>
              {assumed} row{assumed === 1 ? "" : "s"} came from a bay note that named no side, so
              the correction is listed on both outer panels. Check those before sending.
            </span>
          </div>
        )}
        <button
          type="button"
          onClick={() => void exportDeficiencies()}
          disabled={busy || rows.length === 0}
          /* Secondary on purpose — see components/export-button.tsx. A blue
             bar here outshouted the factory sheet and got exported instead. */
          className="mt-3 min-h-14 w-full rounded-xl border border-neutral-300 text-base font-semibold text-neutral-700 active:bg-neutral-100 disabled:opacity-50 dark:border-neutral-700 dark:text-neutral-200 dark:active:bg-neutral-900"
        >
          {busy ? "Building…" : rows.length === 0 ? "No deficiencies to export" : `Export deficiency list — ${rows.length} row${rows.length === 1 ? "" : "s"} (.xlsx)`}
        </button>
      </section>
    </main>
  );
}
