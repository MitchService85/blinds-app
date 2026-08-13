"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  createUnit,
  deleteUnit,
  getFloor,
  getProject,
  listUnits,
  listWindows,
  updateFloor,
  updateUnit,
} from "@/lib/db";
import { checkUnitWindows, type MeasurementWarning } from "@/lib/checks";
import type { Floor, FloorDefaults, Project, Unit, UnitStatus, WindowRecord } from "@/lib/types";
import { UnitTile } from "@/components/unit-tile";
import { FloorDefaultsForm } from "@/components/floor-defaults-form";
import { ExportButton } from "@/components/export-button";
import { triggerSyncIfAvailable } from "@/components/trigger-sync";

interface FloorPageData {
  project: Project | null;
  floor: Floor | null;
  units: Unit[];
  windowsByUnit: Map<string, WindowRecord[]>;
}

/** Pure data load (no state writes) shared by the mount effect and the
 * post-mutation refresh handler used by event handlers below. */
async function loadFloorPageData(projectId: string, floorId: string): Promise<FloorPageData> {
  const [p, f] = await Promise.all([getProject(projectId), getFloor(floorId)]);
  if (!f) return { project: p ?? null, floor: null, units: [], windowsByUnit: new Map() };
  const us = await listUnits(floorId);
  us.sort((a, b) => a.sort_order - b.sort_order);
  const map = new Map<string, WindowRecord[]>();
  await Promise.all(
    us.map(async (u) => {
      map.set(u.id, await listWindows(u.id));
    })
  );
  return { project: p ?? null, floor: f, units: us, windowsByUnit: map };
}

export default function FloorPage() {
  const { projectId, floorId } = useParams<{ projectId: string; floorId: string }>();
  const router = useRouter();

  const [project, setProject] = useState<Project | null>(null);
  const [floor, setFloor] = useState<Floor | null>(null);
  const [units, setUnits] = useState<Unit[]>([]);
  const [windowsByUnit, setWindowsByUnit] = useState<Map<string, WindowRecord[]>>(new Map());
  const [editingDefaults, setEditingDefaults] = useState(false);
  const [addingUnit, setAddingUnit] = useState(false);
  const [newUnitNumber, setNewUnitNumber] = useState("");
  const [addError, setAddError] = useState<string | null>(null);
  const [doneWarnings, setDoneWarnings] = useState<MeasurementWarning[] | null>(null);
  const [noteUnitId, setNoteUnitId] = useState<string | null>(null);

  const warningsByUnit = useMemo(() => {
    const map = new Map<string, MeasurementWarning[]>();
    for (const unit of units) {
      const warnings = checkUnitWindows(unit, windowsByUnit.get(unit.id) ?? []);
      if (warnings.length > 0) map.set(unit.id, warnings);
    }
    return map;
  }, [units, windowsByUnit]);

  async function refresh() {
    const data = await loadFloorPageData(projectId, floorId);
    if (!data.floor) return;
    setProject(data.project);
    setFloor(data.floor);
    setUnits(data.units);
    setWindowsByUnit(data.windowsByUnit);
  }

  useEffect(() => {
    (async () => {
      const data = await loadFloorPageData(projectId, floorId);
      if (!data.floor) return;
      setProject(data.project);
      setFloor(data.floor);
      setUnits(data.units);
      setWindowsByUnit(data.windowsByUnit);
    })();
  }, [projectId, floorId]);

  function nextUnitNumber(): string {
    const numeric = units.map((u) => parseInt(u.number, 10)).filter((n) => !Number.isNaN(n));
    if (numeric.length === 0) return "";
    return String(Math.max(...numeric) + 1);
  }

  function openAddUnit() {
    setNewUnitNumber(nextUnitNumber());
    setAddError(null);
    setAddingUnit(true);
  }

  async function handleAddUnit() {
    const number = newUnitNumber.trim();
    if (!number) {
      setAddError("Enter a unit number.");
      return;
    }
    if (units.some((u) => u.number === number)) {
      setAddError("That unit number already exists on this floor.");
      return;
    }
    await createUnit({ floor_id: floorId, number, status: "active", sort_order: units.length });
    setAddingUnit(false);
    await refresh();
  }

  async function handleSetStatus(unitId: string, status: UnitStatus) {
    await updateUnit(unitId, { status });
    if (status === "done") {
      const unit = units.find((u) => u.id === unitId);
      const warnings = unit ? checkUnitWindows(unit, windowsByUnit.get(unitId) ?? []) : [];
      setDoneWarnings(warnings.length > 0 ? warnings : null);
    }
    await refresh();
  }

  async function handleDeleteUnit(unitId: string) {
    await deleteUnit(unitId);
    await refresh();
  }

  function openNoteEditor(unitId: string) {
    setNoteUnitId(unitId);
  }

  async function handleNoteChange(unitId: string, note: string) {
    setUnits((us) => us.map((u) => (u.id === unitId ? { ...u, note } : u)));
    await updateUnit(unitId, { note });
  }

  async function handleSaveExit() {
    await triggerSyncIfAvailable();
    router.push("/");
  }

  async function handleDefaultsChange(defaults: FloorDefaults) {
    if (!floor) return;
    const updated = await updateFloor(floor.id, { defaults });
    setFloor(updated);
  }

  if (!floor) return <main className="p-4 text-sm text-neutral-500">Loading…</main>;

  return (
    <main className="flex flex-1 flex-col gap-4 p-4 pb-28">
      <header className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => router.push(`/project/${projectId}`)}
          className="min-h-11 min-w-11 text-xl"
        >
          ←
        </button>
        <div>
          <h1 className="text-xl font-semibold">{floor.label}</h1>
          {project && <div className="text-sm text-neutral-500">{project.name}</div>}
        </div>
      </header>

      <button
        type="button"
        onClick={() => setEditingDefaults((v) => !v)}
        className="flex flex-wrap items-center gap-2 rounded-xl border border-neutral-200 p-3 text-left text-xs dark:border-neutral-800"
      >
        <DefaultsSummary defaults={floor.defaults} />
        <span className="ml-auto shrink-0 text-blue-600">Edit</span>
      </button>
      {editingDefaults && (
        <div className="rounded-xl border border-neutral-200 p-4 dark:border-neutral-800">
          <FloorDefaultsForm value={floor.defaults} onChange={handleDefaultsChange} />
        </div>
      )}

      {doneWarnings && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">
          <div className="mb-1 flex items-center justify-between gap-2">
            <span className="font-semibold">Marked done — worth a second look</span>
            <button
              type="button"
              onClick={() => setDoneWarnings(null)}
              aria-label="Dismiss"
              className="min-h-8 min-w-8 shrink-0 text-xs"
            >
              ✕
            </button>
          </div>
          <ul className="flex flex-col gap-1">
            {doneWarnings.map((w) => (
              <li key={w.window_id}>
                ⚠ {w.unit_number}-{w.tag}: {w.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
        {units.map((unit) => (
          <UnitTile
            key={unit.id}
            unit={unit}
            windowCount={windowsByUnit.get(unit.id)?.length ?? 0}
            href={`/project/${projectId}/floor/${floorId}/unit/${unit.id}`}
            hasWarning={warningsByUnit.has(unit.id)}
            onSetStatus={(status) => handleSetStatus(unit.id, status)}
            onDelete={() => handleDeleteUnit(unit.id)}
            onOpenNote={() => openNoteEditor(unit.id)}
          />
        ))}
        <button
          type="button"
          onClick={openAddUnit}
          className="flex min-h-16 items-center justify-center rounded-lg border border-dashed border-neutral-300 text-2xl text-neutral-400 active:bg-neutral-50 dark:border-neutral-700 dark:active:bg-neutral-900"
          aria-label="Add unit"
        >
          +
        </button>
      </div>

      {addingUnit && (
        <div className="rounded-xl border border-neutral-200 p-4 dark:border-neutral-800">
          <label className="mb-1 block text-sm text-neutral-500">Unit number</label>
          <input
            value={newUnitNumber}
            onChange={(e) => {
              setNewUnitNumber(e.target.value);
              setAddError(null);
            }}
            inputMode="numeric"
            autoFocus
            className="min-h-12 w-full rounded-lg border border-neutral-300 px-3 text-lg dark:border-neutral-700 dark:bg-neutral-900"
          />
          {addError && <div className="mt-1 text-sm text-red-600">{addError}</div>}
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={handleAddUnit}
              className="min-h-11 flex-1 rounded-lg bg-blue-600 text-sm font-semibold text-white"
            >
              Add unit
            </button>
            <button
              type="button"
              onClick={() => setAddingUnit(false)}
              className="min-h-11 rounded-lg bg-neutral-100 px-4 text-sm dark:bg-neutral-800"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="fixed inset-x-0 bottom-0 flex gap-3 border-t border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-950">
        <button
          type="button"
          onClick={handleSaveExit}
          className="min-h-14 flex-1 rounded-xl bg-neutral-800 text-base font-semibold text-white dark:bg-neutral-100 dark:text-neutral-900"
        >
          Save & exit
        </button>
        {project && (
          <ExportButton projectName={project.name} floor={floor} units={units} windowsByUnit={windowsByUnit} />
        )}
      </div>

      {noteUnitId && (
        <NoteSheet
          unit={units.find((u) => u.id === noteUnitId) ?? null}
          onChange={(note) => handleNoteChange(noteUnitId, note)}
          onClose={() => setNoteUnitId(null)}
        />
      )}
    </main>
  );
}

function NoteSheet({
  unit,
  onChange,
  onClose,
}: {
  unit: Unit | null;
  onChange: (note: string) => void;
  onClose: () => void;
}) {
  if (!unit) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-xl bg-white p-4 dark:bg-neutral-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-2 text-sm font-semibold">Unit {unit.number} note</div>
        <textarea
          value={unit.note}
          onChange={(e) => onChange(e.target.value)}
          placeholder="e.g. shim, needs fascia, PRIORITY"
          rows={3}
          autoFocus
          className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900"
        />
        <button
          type="button"
          onClick={onClose}
          className="mt-3 min-h-11 w-full rounded-lg bg-neutral-100 text-sm font-medium dark:bg-neutral-800"
        >
          Done
        </button>
      </div>
    </div>
  );
}

function DefaultsSummary({ defaults }: { defaults: FloorDefaults }) {
  const parts = [
    defaults.roll ? "Rev" : null,
    `Drive ${defaults.drive}`,
    defaults.tight ? "Tight" : null,
    `D=${defaults.d_value}`,
    defaults.extra_note || null,
  ].filter((p): p is string => Boolean(p));

  return (
    <>
      {parts.map((p) => (
        <span key={p} className="rounded-full bg-neutral-100 px-2 py-1 dark:bg-neutral-800">
          {p}
        </span>
      ))}
    </>
  );
}
