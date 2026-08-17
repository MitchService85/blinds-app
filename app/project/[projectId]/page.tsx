"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { createFloor, getProject, listFloors, listUnits, updateProject } from "@/lib/db";
import type { Floor, FloorDefaults, Project } from "@/lib/types";
import { TagChipEditor } from "@/components/tag-chip-editor";
import { FloorDefaultsForm } from "@/components/floor-defaults-form";

function defaultFloorDefaults(): FloorDefaults {
  return {
    roll: false,
    drive: "R",
    tight: false,
    extra_note: "",
    d_value: "1/2",
    color_codes: { bed: "", liv: "", studio: "", kitchen: "" },
  };
}

interface FloorRow {
  floor: Floor;
  done: number;
  total: number;
}

/** Pure data load (no state writes) so both the mount effect and the
 * post-mutation refresh handler below can share it without the effect
 * calling out to a component-level function that sets state itself. */
async function loadProjectData(projectId: string): Promise<{ project: Project | null; floors: FloorRow[] }> {
  const p = await getProject(projectId);
  if (!p) return { project: null, floors: [] };
  const fs = await listFloors(projectId);
  const rows: FloorRow[] = [];
  for (const floor of fs) {
    const units = await listUnits(floor.id);
    const relevant = units.filter((u) => u.status !== "na");
    rows.push({
      floor,
      done: relevant.filter((u) => u.status === "done").length,
      total: relevant.length,
    });
  }
  return { project: p, floors: rows };
}

export default function ProjectPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const router = useRouter();
  const [project, setProject] = useState<Project | null>(null);
  const [floors, setFloors] = useState<FloorRow[]>([]);
  const [adding, setAdding] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  const [newDefaults, setNewDefaults] = useState<FloorDefaults>(defaultFloorDefaults());
  const [saving, setSaving] = useState(false);
  const [editingInfo, setEditingInfo] = useState(false);

  async function refresh() {
    const { project: p, floors: rows } = await loadProjectData(projectId);
    if (p) setProject(p);
    setFloors(rows);
  }

  useEffect(() => {
    (async () => {
      const { project: p, floors: rows } = await loadProjectData(projectId);
      if (p) setProject(p);
      setFloors(rows);
    })();
  }, [projectId]);

  async function handleAddFloor() {
    if (!newLabel.trim() || saving) return;
    setSaving(true);
    try {
      await createFloor({ project_id: projectId, label: newLabel.trim(), defaults: newDefaults });
      setNewLabel("");
      setNewDefaults(defaultFloorDefaults());
      setAdding(false);
      await refresh();
    } finally {
      setSaving(false);
    }
  }

  async function handleChipsChange(chips: string[]) {
    if (!project) return;
    const updated = await updateProject(project.id, { tag_chips: chips });
    setProject(updated);
  }

  if (!project) return <main className="p-4 text-sm text-neutral-500">Loading…</main>;

  /** Both fields in one write — two racing read-modify-write patches can
   * clobber each other (same lesson as the floor's order/trips fields). */
  async function handleInfoChange(name: string, address: string) {
    if (!project) return;
    setProject({ ...project, name, address });
    const updated = await updateProject(project.id, { name, address });
    setProject(updated);
  }

  return (
    <main className="flex flex-1 flex-col gap-6 p-4 pb-10">
      <header className="flex items-center gap-3">
        <button type="button" onClick={() => router.push("/")} className="min-h-11 min-w-11 text-xl">
          ←
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-semibold break-words">{project.name}</h1>
          <div className="text-sm text-neutral-500">{project.address}</div>
        </div>
        <button
          type="button"
          onClick={() => setEditingInfo((v) => !v)}
          className="shrink-0 text-sm text-blue-600"
        >
          {editingInfo ? "Done" : "Edit"}
        </button>
      </header>

      {editingInfo && (
        <section className="flex flex-col gap-3 rounded-xl border border-neutral-200 p-4 dark:border-neutral-800">
          <label>
            <span className="mb-1 block text-sm text-neutral-500">Project name</span>
            <input
              value={project.name}
              onChange={(e) => handleInfoChange(e.target.value, project.address)}
              className="min-h-12 w-full rounded-lg border border-neutral-300 px-3 dark:border-neutral-700 dark:bg-neutral-900"
            />
            <span className="mt-1 block text-xs text-neutral-400">
              Used in the export: “{project.name || "Project"} - Floor.xlsx”
            </span>
          </label>
          <label>
            <span className="mb-1 block text-sm text-neutral-500">Address</span>
            <input
              value={project.address}
              onChange={(e) => handleInfoChange(project.name, e.target.value)}
              className="min-h-12 w-full rounded-lg border border-neutral-300 px-3 dark:border-neutral-700 dark:bg-neutral-900"
            />
          </label>
        </section>
      )}

      <section>
        <h2 className="mb-2 text-sm font-semibold text-neutral-500">Floors / batches</h2>
        <div className="flex flex-col gap-2">
          {floors.map(({ floor, done, total }) => (
            <Link
              key={floor.id}
              href={`/project/${projectId}/floor/${floor.id}`}
              className="flex min-h-14 items-center justify-between rounded-xl border border-neutral-200 p-4 active:bg-neutral-50 dark:border-neutral-800 dark:active:bg-neutral-900"
            >
              <span className="font-medium">{floor.label}</span>
              <span className="text-sm text-neutral-500">
                {total > 0 && done === total ? "✓ done" : `${done}/${total}`}
              </span>
            </Link>
          ))}
        </div>

        {adding ? (
          <div className="mt-3 rounded-xl border border-neutral-200 p-4 dark:border-neutral-800">
            <input
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              placeholder="Level 5 or Batch 4"
              autoFocus
              className="mb-3 min-h-11 w-full rounded-lg border border-neutral-300 px-3 font-medium dark:border-neutral-700 dark:bg-neutral-900"
            />
            <FloorDefaultsForm value={newDefaults} onChange={setNewDefaults} />
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={handleAddFloor}
                disabled={!newLabel.trim() || saving}
                className="min-h-11 flex-1 rounded-lg bg-blue-600 text-sm font-semibold text-white disabled:opacity-50"
              >
                {saving ? "Adding…" : "Add floor"}
              </button>
              <button
                type="button"
                onClick={() => setAdding(false)}
                className="min-h-11 rounded-lg bg-neutral-100 px-4 text-sm dark:bg-neutral-800"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="mt-3 min-h-11 w-full rounded-lg bg-neutral-100 text-sm font-medium dark:bg-neutral-800"
          >
            + Add floor
          </button>
        )}
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-neutral-500">Room tags</h2>
        <TagChipEditor chips={project.tag_chips} onChange={handleChipsChange} />
      </section>
    </main>
  );
}
