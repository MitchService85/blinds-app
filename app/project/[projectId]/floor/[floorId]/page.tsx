"use client";

import { sortUnitsForDisplay } from "@/lib/unit-sort";
import { useEffect, useMemo, useRef, useState } from "react";
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
import type { Floor, FloorDefaults, InstallStatus, Project, Unit, UnitStatus, WindowRecord } from "@/lib/types";
import { UnitTile } from "@/components/unit-tile";
import { InstallTile } from "@/components/install-tile";
import { InstallActionSheet, type InstallAction } from "@/components/install-action-sheet";
import { blockedOf, installOf } from "@/components/status";
import { FloorDefaultsForm } from "@/components/floor-defaults-form";
import { ExportButton } from "@/components/export-button";
import { triggerSyncIfAvailable } from "@/components/trigger-sync";
import { effectiveMount, effectiveTight } from "@/lib/export/shared";

type FloorMode = "measure" | "install";
const FLOOR_MODE_KEY_PREFIX = "measure:floorMode:";

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
  const us = sortUnitsForDisplay(await listUnits(floorId));
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
  // True until the tech types in the add-unit box. The auto-suggested next
  // number ("431") is accepted by just tapping Add, but the first keystroke
  // REPLACES it — nobody should have to backspace a suggestion away when
  // the building isn't measured in order (field note, 44 Charles batch 4).
  const [unitInputPristine, setUnitInputPristine] = useState(true);
  const [addError, setAddError] = useState<string | null>(null);
  const [doneWarnings, setDoneWarnings] = useState<MeasurementWarning[] | null>(null);
  const [noteUnitId, setNoteUnitId] = useState<string | null>(null);
  const [mode, setMode] = useState<FloorMode>("measure");
  const [installSheetUnitId, setInstallSheetUnitId] = useState<string | null>(null);

  useEffect(() => {
    const stored = window.localStorage.getItem(`${FLOOR_MODE_KEY_PREFIX}${floorId}`);
    // One-time sync from an external store (localStorage) on mount, guarded
    // to client-only so the server-rendered/hydration-time default
    // ("measure") never mismatches — not a props/state mirroring anti-pattern.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (stored === "measure" || stored === "install") setMode(stored);
  }, [floorId]);

  function selectMode(next: FloorMode) {
    setMode(next);
    window.localStorage.setItem(`${FLOOR_MODE_KEY_PREFIX}${floorId}`, next);
  }

  const warningsByUnit = useMemo(() => {
    const map = new Map<string, MeasurementWarning[]>();
    for (const unit of units) {
      const warnings = checkUnitWindows(unit, windowsByUnit.get(unit.id) ?? []);
      if (warnings.length > 0) map.set(unit.id, warnings);
    }
    return map;
  }, [units, windowsByUnit]);

  const installSummary = useMemo(() => {
    let staged = 0;
    let done = 0;
    let blocked = 0;
    let toGo = 0;
    const blockedUnits: Unit[] = [];
    for (const u of units) {
      if (u.status === "na") continue;
      const isBlocked = blockedOf(u);
      const install = installOf(u);
      if (isBlocked) {
        blocked++;
        blockedUnits.push(u);
      } else if (install === "staged") {
        staged++;
      } else if (install === "done") {
        done++;
      }
      if (!isBlocked && install !== "done") toGo++;
    }
    return { staged, done, blocked, toGo, blockedUnits };
  }, [units]);

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

  /**
   * Suggest the next unit number by incrementing the *last-added* unit's
   * number — but only when that number is purely numeric ("430" -> "431").
   * Commercial jobs use free-text zone labels ("Level 1 - FE", "L1- Snake
   * Corridor") as the unit "number"; those must never get auto-incremented
   * from, so the field is just left blank for the tech to type their own.
   */
  function nextUnitNumber(): string {
    if (units.length === 0) return "";
    const sorted = [...units].sort((a, b) => a.sort_order - b.sort_order);
    const last = sorted[sorted.length - 1].number.trim();
    if (!/^\d+$/.test(last)) return "";
    return String(parseInt(last, 10) + 1);
  }

  const addUnitPanelRef = useRef<HTMLDivElement | null>(null);

  function openAddUnit() {
    setNewUnitNumber(nextUnitNumber());
    setUnitInputPristine(true);
    setAddError(null);
    setAddingUnit(true);
    // The panel renders below a long grid, behind the sticky Save & exit bar
    // (and the keyboard on iOS) — bring it into view once it exists. The
    // second, delayed pass re-centers after the on-screen keyboard resizes
    // the visual viewport.
    requestAnimationFrame(() => {
      addUnitPanelRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
      addUnitPanelRef.current?.querySelector("input")?.focus();
      setTimeout(() => {
        addUnitPanelRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
      }, 350);
    });
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

  /**
   * Staged/Complete/Clear are simple writes that close the sheet. Blocked
   * always sets install_blocked, but doesn't touch install itself (blocked
   * is an independent overlay — see Unit.install_blocked): if the unit's
   * note is empty, it hands off straight to the existing note sheet (a
   * block needs an explanation); if a note already exists, the action sheet
   * stays open showing it (see InstallActionSheet).
   */
  async function handleInstallAction(unitId: string, action: InstallAction) {
    const unit = units.find((u) => u.id === unitId);
    if (!unit) return;

    let patch: { install?: InstallStatus; install_blocked?: boolean };
    switch (action) {
      case "staged":
        patch = { install: "staged", install_blocked: false };
        break;
      case "complete":
        patch = { install: "done", install_blocked: false };
        break;
      case "clear":
        patch = { install: null, install_blocked: false };
        break;
      case "blocked":
        patch = { install_blocked: true };
        break;
    }
    await updateUnit(unitId, patch);

    if (action === "blocked") {
      if (!unit.note) {
        setInstallSheetUnitId(null);
        setNoteUnitId(unitId);
      }
      // else: leave the sheet open so the just-set blocked state + existing
      // note preview show (refresh below brings in the fresh unit).
    } else {
      setInstallSheetUnitId(null);
    }
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

  /** Always writes BOTH job-info fields in one update: two separate
   * read-modify-write patches issued back-to-back can interleave and clobber
   * each other (updateFloor reads the row before writing). */
  async function handleJobInfoChange(orderNumber: string, trips: number | null) {
    if (!floor) return;
    setFloor({ ...floor, order_number: orderNumber, trips });
    const updated = await updateFloor(floor.id, { order_number: orderNumber, trips });
    setFloor(updated);
  }

  /** Total blinds on the floor (each bay panel is one blind) — invoicing quantity. */
  const blindCount = useMemo(() => {
    let n = 0;
    for (const u of units) {
      if (u.status === "na") continue;
      for (const w of windowsByUnit.get(u.id) ?? []) n += w.widths.length * (w.quantity ?? 1);
    }
    return n;
  }, [units, windowsByUnit]);

  if (!floor) return <main className="p-4 text-sm text-neutral-500">Loading…</main>;

  return (
    <main className="flex flex-1 flex-col gap-4 p-4 pb-28">
      <header className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => router.push(`/project/${projectId}`)}
          className="min-h-11 min-w-11 shrink-0 text-xl"
        >
          ←
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-xl font-semibold">{floor.label}</h1>
          {project && <div className="text-sm text-neutral-500">{project.name}</div>}
        </div>
        <div className="flex shrink-0 overflow-hidden rounded-lg border border-neutral-300 dark:border-neutral-700">
          {(["measure", "install"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => selectMode(m)}
              aria-pressed={mode === m}
              className={`min-h-9 px-3 text-xs font-medium capitalize ${
                mode === m
                  ? "bg-blue-600 text-white"
                  : "bg-white text-neutral-600 dark:bg-neutral-900 dark:text-neutral-300"
              }`}
            >
              {m}
            </button>
          ))}
        </div>
      </header>

      <button
        type="button"
        onClick={() => setEditingDefaults((v) => !v)}
        className="flex flex-wrap items-center gap-2 rounded-xl border border-neutral-200 p-3 text-left text-xs dark:border-neutral-800"
      >
        <DefaultsSummary defaults={floor.defaults} />
        <JobInfoChips orderNumber={floor.order_number ?? ""} trips={floor.trips ?? null} blinds={blindCount} />
        <span className="ml-auto shrink-0 text-blue-600">Edit</span>
      </button>
      {editingDefaults && (
        <div className="flex flex-col gap-4 rounded-xl border border-neutral-200 p-4 dark:border-neutral-800">
          <div className="flex gap-3">
            <label className="flex-1">
              <span className="mb-1 block text-sm text-neutral-500">Order number</span>
              <input
                value={floor.order_number ?? ""}
                onChange={(e) => handleJobInfoChange(e.target.value, floor.trips ?? null)}
                placeholder="e.g. 48291"
                className="min-h-12 w-full rounded-lg border border-neutral-300 px-3 dark:border-neutral-700 dark:bg-neutral-900"
              />
            </label>
            <label className="w-28">
              <span className="mb-1 block text-sm text-neutral-500">Trips</span>
              <input
                type="text"
                inputMode="numeric"
                value={floor.trips ?? ""}
                onChange={(e) => {
                  const v = e.target.value.replace(/\D/g, "");
                  handleJobInfoChange(floor.order_number ?? "", v === "" ? null : parseInt(v, 10));
                }}
                placeholder="0"
                className="min-h-12 w-full rounded-lg border border-neutral-300 px-3 dark:border-neutral-700 dark:bg-neutral-900"
              />
            </label>
          </div>
          <FloorDefaultsForm value={floor.defaults} onChange={handleDefaultsChange} />
        </div>
      )}

      {mode === "measure" && doneWarnings && (
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

      {mode === "install" && (
        <>
          <div className="text-sm text-neutral-600 dark:text-neutral-400">
            🟢 {installSummary.staged} staged · ✅ {installSummary.done} done · ⚠️{" "}
            {installSummary.blocked} blocked · {installSummary.toGo} to go
          </div>
          {installSummary.blockedUnits.length > 0 && (
            <div className="flex flex-col gap-1 rounded-lg bg-amber-50 p-2 text-xs text-amber-900 dark:bg-amber-950 dark:text-amber-200">
              {installSummary.blockedUnits.map((u) => (
                <div key={u.id}>
                  ⚠️ {u.number} — &quot;{u.note || "no note"}&quot;
                </div>
              ))}
            </div>
          )}
        </>
      )}

      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
        {mode === "measure"
          ? units.map((unit) => (
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
            ))
          : units.map((unit) => (
              <InstallTile key={unit.id} unit={unit} onTap={() => setInstallSheetUnitId(unit.id)} />
            ))}
        {mode === "measure" && (
          <button
            type="button"
            onClick={openAddUnit}
            className="flex min-h-16 items-center justify-center rounded-lg border border-dashed border-neutral-300 text-2xl text-neutral-400 active:bg-neutral-50 dark:border-neutral-700 dark:active:bg-neutral-900"
            aria-label="Add unit"
          >
            +
          </button>
        )}
      </div>

      {mode === "measure" && addingUnit && (
        <div ref={addUnitPanelRef} className="rounded-xl border border-neutral-200 p-4 dark:border-neutral-800">
          <label className="mb-1 block text-sm text-neutral-500">Unit number or zone label</label>
          <input
            value={newUnitNumber}
            onChange={(e) => {
              const typed = e.target.value;
              if (unitInputPristine && newUnitNumber && typed.startsWith(newUnitNumber)) {
                // First keystroke lands after the suggestion — keep only
                // what was typed, dropping the suggestion.
                setNewUnitNumber(typed.slice(newUnitNumber.length));
              } else {
                setNewUnitNumber(typed);
              }
              setUnitInputPristine(false);
              setAddError(null);
            }}
            onFocus={(e) => e.target.select()}
            placeholder={`e.g. "431" or "Level 1 - FE"`}
            type="text"
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

      <div className="safe-bottom fixed inset-x-0 bottom-0 flex gap-3 border-t border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-950">
        <button
          type="button"
          onClick={handleSaveExit}
          className="min-h-14 flex-1 rounded-xl bg-neutral-800 text-base font-semibold text-white dark:bg-neutral-100 dark:text-neutral-900"
        >
          Save & exit
        </button>
        {project && (
          <ExportButton
            projectName={project.name}
            floor={floor}
            units={units}
            windowsByUnit={windowsByUnit}
          />
        )}
      </div>

      {noteUnitId && (
        <NoteSheet
          unit={units.find((u) => u.id === noteUnitId) ?? null}
          onChange={(note) => handleNoteChange(noteUnitId, note)}
          onClose={() => setNoteUnitId(null)}
        />
      )}

      {installSheetUnitId && (
        <InstallActionSheet
          unit={units.find((u) => u.id === installSheetUnitId) ?? null}
          onAction={(action) => handleInstallAction(installSheetUnitId, action)}
          onOpenUnit={() => router.push(`/project/${projectId}/floor/${floorId}/unit/${installSheetUnitId}`)}
          onEditNote={() => {
            const id = installSheetUnitId;
            setInstallSheetUnitId(null);
            openNoteEditor(id);
          }}
          onClose={() => setInstallSheetUnitId(null)}
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

function JobInfoChips({
  orderNumber,
  trips,
  blinds,
}: {
  orderNumber: string;
  trips: number | null;
  blinds: number;
}) {
  const chips = [
    orderNumber ? `Order #${orderNumber}` : null,
    trips !== null ? `${trips} trip${trips === 1 ? "" : "s"}` : null,
    `${blinds} blinds`,
  ].filter(Boolean) as string[];
  return (
    <>
      {chips.map((c) => (
        <span
          key={c}
          className="rounded-full bg-blue-50 px-2.5 py-1 font-medium text-blue-700 dark:bg-blue-950 dark:text-blue-300"
        >
          {c}
        </span>
      ))}
    </>
  );
}

function DefaultsSummary({ defaults }: { defaults: FloorDefaults }) {
  const parts = [
    defaults.roll ? "Rev" : null,
    `Drive ${defaults.drive}`,
    // Tight and mount are separate chips: they answer different questions
    // (how it was measured vs where it sits) and a floor can be both.
    effectiveTight(defaults) ? "Tight" : null,
    (() => {
      const mount = effectiveMount(defaults);
      return mount === "inside" ? "Inside" : mount === "outside" ? "Outside" : null;
    })(),
    defaults.motorized ? "Motorized" : null,
    defaults.chain_type ? `${defaults.chain_type} chain` : null,
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
