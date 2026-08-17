"use client";

import { checkUnitWindows } from "@/lib/checks";
import { compressImage } from "@/lib/photos";
import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  createWindow,
  deleteWindow,
  getFloor,
  getProject,
  getUnit,
  listUnits,
  listWindows,
  updateUnit,
  upsertWindow,
  createPhoto,
  deletePhoto,
  listPhotos,
} from "@/lib/db";
import { computeTagLabels } from "@/lib/tags";
import { floorToEighth, formatFraction } from "@/lib/fractions";
import type { ControlOverride, Deduct, Floor, Project, Unit, WindowRecord, UnitPhoto } from "@/lib/types";
import { Keypad, usePrecision } from "@/components/keypad";
import { syncUnitTagIndices } from "@/components/window-tags";

interface DraftWindow {
  id: string | null;
  /**
   * null = no tag chosen yet (nothing tappable has happened for this draft).
   * "" = explicitly "No tag" — valid for office/zone-run entry (see spec:
   * Alcon 2665 Meadowpine), never routed through computeTagLabels/numbered.
   * Anything else = a real room tag.
   */
  tag_base: string | null;
  widths: number[];
  height: number;
  /** Identical-blind multiplier (Cleveland Clinic Q column). */
  quantity: number;
  control_override: ControlOverride;
  deduct: Deduct;
  longer_chain: boolean;
  note: string;
}

function blankDraft(): DraftWindow {
  return {
    id: null,
    tag_base: null,
    widths: [0],
    height: 0,
    quantity: 1,
    control_override: null,
    deduct: null,
    longer_chain: false,
    note: "",
  };
}

const DEDUCT_OPTIONS: Array<[Exclude<Deduct, null>, string]> = [
  ["Dl", "Left"],
  ["Dr", "Right"],
  ["D", "Both"],
];

export default function WindowEntryPage() {
  const { projectId, floorId, unitId } = useParams<{
    projectId: string;
    floorId: string;
    unitId: string;
  }>();
  const router = useRouter();

  const [unit, setUnit] = useState<Unit | null>(null);
  const [floor, setFloor] = useState<Floor | null>(null);
  const [project, setProject] = useState<Project | null>(null);
  const [windows, setWindows] = useState<WindowRecord[]>([]);
  const [floorWindows, setFloorWindows] = useState<WindowRecord[]>([]);
  const [draft, setDraft] = useState<DraftWindow>(blankDraft());
  const [activeField, setActiveField] = useState<number | "height">(0);
  const [precision, setPrecision] = usePrecision();
  const [error, setError] = useState<string | null>(null);
  const [noteOpen, setNoteOpen] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  // Bumped only when a genuinely different window becomes the draft (loaded
  // for edit, or cleared after Save · next). Used for the Keypad's remount
  // key — draft.id is NOT usable there: it flips null -> uuid when the row is
  // lazily created on the first digit tap, which would remount the keypad
  // mid-entry and swallow that digit.
  const [draftSeq, setDraftSeq] = useState(0);
  const [unitNoteOpen, setUnitNoteOpen] = useState(false);
  const [photos, setPhotos] = useState<UnitPhoto[]>([]);
  const [photoView, setPhotoView] = useState<UnitPhoto | null>(null);
  const [photoBusy, setPhotoBusy] = useState(false);

  const draftRef = useRef(draft);
  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  const windowsRef = useRef(windows);
  useEffect(() => {
    windowsRef.current = windows;
  }, [windows]);

  // Serializes the "no row yet, create it on first real edit" path in
  // patchDraft below so a fast burst of digit taps (rapid-fire zone-run
  // entry) can't race and create duplicate window rows.
  const writeQueueRef = useRef<Promise<void>>(Promise.resolve());

  const refreshWindows = useCallback(async () => {
    const ws = await listWindows(unitId);
    ws.sort((a, b) => a.sort_order - b.sort_order);
    setWindows(ws);
    setFloorWindows((prev) => [...prev.filter((w) => w.unit_id !== unitId), ...ws]);
    return ws;
  }, [unitId]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const [u, f] = await Promise.all([getUnit(unitId), getFloor(floorId)]);
      if (!u || !f || cancelled) return;
      const p = await getProject(f.project_id);
      if (cancelled) return;
      setUnit(u);
      setFloor(f);
      setProject(p ?? null);
      setPhotos(await listPhotos(u.id));
      if (p?.building_type === "commercial") {
        // Office/zone-run jobs are almost always untagged windows — default
        // the "No tag" chip so rapid-fire entry never needs an extra tap.
        setDraft((d) => (d.tag_base === null && d.id === null ? { ...d, tag_base: "" } : d));
      }

      const allUnits = await listUnits(floorId);
      const all: WindowRecord[] = [];
      await Promise.all(
        allUnits.map(async (unitRow) => {
          const ws = await listWindows(unitRow.id);
          all.push(...ws);
        })
      );
      if (cancelled) return;
      setFloorWindows(all);
      setWindows(
        all.filter((w) => w.unit_id === unitId).sort((a, b) => a.sort_order - b.sort_order)
      );
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [unitId, floorId]);

  // Best-effort cleanup: drop a truly-empty draft row (tag picked, nothing
  // else ever entered) if the user navigates away mid-edit.
  useEffect(() => {
    return () => {
      const d = draftRef.current;
      const isEmpty =
        d.id &&
        d.widths.every((w) => w === 0) &&
        d.height === 0 &&
        !d.note &&
        !d.deduct &&
        !d.longer_chain &&
        !d.control_override;
      if (isEmpty) void deleteWindow(d.id!);
    };
  }, []);

  function findPrefillHeight(tag: string): number {
    const matches = floorWindows.filter((w) => w.tag_base === tag && w.height > 0);
    if (matches.length === 0) return 0;
    matches.sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1));
    return matches[0].height;
  }

  function patchDraft(patch: Partial<Omit<DraftWindow, "id" | "tag_base">>) {
    setDraft((d) => ({ ...d, ...patch }));
    // Keep the ref in lockstep synchronously — the queued lazy-create below
    // reads draftRef.current, and the effect that syncs it has not run yet,
    // so without this the created row persists the pre-tap values.
    draftRef.current = { ...draftRef.current, ...patch };

    if (draft.id) {
      const id = draft.id;
      const current = windows.find((w) => w.id === id);
      if (current) {
        const merged: WindowRecord = { ...current, ...patch };
        void upsertWindow(merged);
        setWindows((ws) => ws.map((w) => (w.id === id ? merged : w)));
      }
      return;
    }

    if (draft.tag_base === null) return; // nothing chosen yet — nothing to persist

    // A tag is already set (commercial "No tag" auto-default, or carried
    // over from Save · next) but no row exists yet. Create it now, on the
    // first real edit, so rapid-fire zone-run entry is just width-tap-save —
    // queued so a fast burst of taps can't race and create duplicate rows.
    writeQueueRef.current = writeQueueRef.current.then(async () => {
      if (draftRef.current.id !== null) return; // an earlier queued turn already created it
      const latest = draftRef.current;
      const created = await createWindow({
        unit_id: unitId,
        tag_base: latest.tag_base ?? "",
        tag_index: 0,
        widths: latest.widths,
        height: latest.height,
        quantity: latest.quantity,
        control_override: latest.control_override,
        deduct: latest.deduct,
        longer_chain: latest.longer_chain,
        note: latest.note,
        sort_order: windowsRef.current.length,
      });
      draftRef.current = { ...draftRef.current, id: created.id };
      setDraft((d) => (d.id === null ? { ...d, id: created.id } : d));
      await syncUnitTagIndices(unitId);
      await refreshWindows();
    });
  }

  async function selectTag(tag: string) {
    setError(null);
    if (draft.id) {
      const id = draft.id;
      const current = windows.find((w) => w.id === id);
      setDraft((d) => ({ ...d, tag_base: tag }));
      if (current) {
        await upsertWindow({ ...current, tag_base: tag });
      }
      await syncUnitTagIndices(unitId);
      await refreshWindows();
      return;
    }

    const height = draft.height || findPrefillHeight(tag);
    const created = await createWindow({
      unit_id: unitId,
      tag_base: tag,
      tag_index: 0,
      widths: draft.widths,
      height,
      control_override: draft.control_override,
      deduct: draft.deduct,
      longer_chain: draft.longer_chain,
      note: draft.note,
      sort_order: windows.length,
    });
    setDraft((d) => ({ ...d, id: created.id, tag_base: tag, height }));
    await syncUnitTagIndices(unitId);
    await refreshWindows();
  }

  function setPanelWidth(index: number, sixteenths: number) {
    const widths = draft.widths.map((w, i) => (i === index ? sixteenths : w));
    patchDraft({ widths });
  }

  function addPanel() {
    // Field note (Mitch, 44 Charles batch 4): copying the previous width
    // into the new panel forced a Clear tap almost every time — the fraction
    // half of the keypad buffer survived typing over it. New panels start
    // empty instead.
    const widths = [...draft.widths, 0];
    patchDraft({ widths });
    setActiveField(widths.length - 1);
    setDraftSeq((n) => n + 1);
  }

  function removePanel(index: number) {
    if (draft.widths.length <= 1) return;
    const widths = draft.widths.filter((_, i) => i !== index);
    patchDraft({ widths });
    setActiveField((f) => (f === "height" ? f : Math.min(f, widths.length - 1)));
  }

  async function handleDeleteWindow(id: string) {
    await deleteWindow(id);
    await syncUnitTagIndices(unitId);
    await refreshWindows();
    if (draft.id === id) setDraft(blankDraft());
  }

  function loadForEdit(w: WindowRecord) {
    setDraft({
      id: w.id,
      tag_base: w.tag_base,
      widths: [...w.widths],
      height: w.height,
      quantity: w.quantity ?? 1,
      control_override: w.control_override,
      deduct: w.deduct,
      longer_chain: w.longer_chain,
      note: w.note,
    });
    setNoteOpen(Boolean(w.note));
    setActiveField(0);
    setError(null);
    setDraftSeq((n) => n + 1);
  }

  function handleSaveNext() {
    if (draft.tag_base === null) {
      setError("Pick a tag — or No tag.");
      return;
    }
    if (draft.widths.some((w) => w <= 0)) {
      setError("Enter a width for every panel.");
      return;
    }
    if (draft.height <= 0) {
      setError("Enter a height.");
      return;
    }
    setError(null);
    setDraft({
      id: null,
      // Carry the tag and height forward — rapid-fire zone-run entry (see
      // spec: office format) is then just width-tap-save repeated; the row
      // for this next window is created lazily by patchDraft on the first
      // width tap, so focus can go straight to width entry.
      tag_base: draft.tag_base,
      widths: [0],
      height: draft.height,
      quantity: 1,
      control_override: null,
      deduct: null,
      longer_chain: false,
      note: "",
    });
    setActiveField(0);
    setNoteOpen(false);
    setDraftSeq((n) => n + 1);
    // Brief visual confirmation on the button itself — the data is already
    // durable (autosave writes on every tap), this just closes the loop for
    // someone measuring fast and not watching the header indicator.
    setJustSaved(true);
    window.setTimeout(() => setJustSaved(false), 1200);
  }

  async function handleAddPhoto(file: File | undefined) {
    if (!file || !unit) return;
    setPhotoBusy(true);
    try {
      const data = await compressImage(file);
      await createPhoto({ unit_id: unit.id, data });
      setPhotos(await listPhotos(unit.id));
    } finally {
      setPhotoBusy(false);
    }
  }

  async function handleDeletePhoto(id: string) {
    await deletePhoto(id);
    setPhotoView(null);
    if (unit) setPhotos(await listPhotos(unit.id));
  }

  async function handleUnitNoteChange(note: string) {
    setUnit((u) => (u ? { ...u, note } : u));
    if (unit) await updateUnit(unit.id, { note });
  }

  /** Preview of the tag suffix for a real (non-empty) draft.tag_base only —
   * untagged ("No tag") windows never go through computeTagLabels; see
   * caller and components/window-tags.ts. */
  function previewLabel(): string {
    if (!draft.tag_base) return "";
    const draftId = draft.id ?? "__draft__";
    const others = windows.filter((w) => w.id !== draftId && w.tag_base !== "");
    const forCalc = [
      ...others.map((w) => ({ id: w.id, tag_base: w.tag_base, sort_order: w.sort_order, deleted: false })),
      {
        id: draftId,
        tag_base: draft.tag_base,
        sort_order: draft.id
          ? (windows.find((w) => w.id === draft.id)?.sort_order ?? windows.length)
          : windows.length,
        deleted: false,
      },
    ];
    return computeTagLabels(forCalc).get(draftId) ?? draft.tag_base;
  }

  if (!unit) return <main className="p-4 text-sm text-neutral-500">Loading…</main>;

  // Untagged windows (zone runs) never get numbered — see
  // components/window-tags.ts. Their display label is just their 1-based
  // position in the unit's (sort_order-ordered) window list.
  const windowLabels = computeTagLabels(windows.filter((w) => w.tag_base !== ""));
  function displayLabelFor(w: WindowRecord): string {
    if (w.tag_base === "") return `#${windows.findIndex((x) => x.id === w.id) + 1}`;
    return windowLabels.get(w.id) ?? w.tag_base;
  }
  const activeIsHeight = activeField === "height";

  const windowWarnings = new Map(
    unit ? checkUnitWindows(unit, windows).map((w) => [w.window_id, w.message]) : []
  );

  return (
    <main className="flex flex-1 flex-col gap-4 p-4 pb-8">
      {/* Sticky, mirroring the floating Save button at the bottom: after
          finishing a window mid-scroll, back is always one tap away. Full
          bleed over the page padding so content slides underneath. */}
      <header className="sticky top-0 z-20 -mx-4 -mt-4 flex items-center gap-3 bg-white/95 px-4 py-3 backdrop-blur dark:bg-neutral-950/95">
        <button
          type="button"
          onClick={() => router.push(`/project/${projectId}/floor/${floorId}`)}
          className="min-h-11 min-w-11 shrink-0 text-xl"
        >
          ←
        </button>
        <div className="min-w-0 flex-1">
          {/* Full unit number / zone label, no truncation — the floor
              grid's tiles are where long labels ("L1- Snake Corridor")
              get ellipsis-truncated instead. */}
          <h1 className="text-xl font-semibold break-words">Unit {unit.number}</h1>
          {floor && <div className="text-sm text-neutral-500">{floor.label}</div>}
        </div>
        {draft.id && (
          <span className="shrink-0 text-xs text-emerald-600 dark:text-emerald-400">✓ saved</span>
        )}
      </header>

      <button
        type="button"
        onClick={() => setUnitNoteOpen((v) => !v)}
        className="flex min-h-11 items-center gap-2 rounded-lg border border-dashed border-neutral-300 px-3 py-2 text-left text-sm text-neutral-600 dark:border-neutral-700 dark:text-neutral-300"
      >
        <span>📝</span>
        <span className="flex-1 truncate">{unit.note || "Add a note for this unit"}</span>
        <span className="shrink-0 text-xs text-blue-600">Edit</span>
      </button>
      {unitNoteOpen && (
        <textarea
          value={unit.note}
          onChange={(e) => handleUnitNoteChange(e.target.value)}
          placeholder="e.g. shim, needs fascia, PRIORITY"
          rows={2}
          autoFocus
          className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900"
        />
      )}

      {(photos.length > 0 || unitNoteOpen) && (
        <div className="flex flex-wrap items-center gap-2">
          {photos.map((ph) => (
            <button
              key={ph.id}
              type="button"
              onClick={() => setPhotoView(ph)}
              className="h-16 w-16 overflow-hidden rounded-lg border border-neutral-300 dark:border-neutral-700"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={ph.data} alt="Unit note photo" className="h-full w-full object-cover" />
            </button>
          ))}
          <label className="flex h-16 w-16 cursor-pointer items-center justify-center rounded-lg border border-dashed border-neutral-300 text-2xl text-neutral-500 dark:border-neutral-700">
            {photoBusy ? "…" : "📷"}
            <input
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={(e) => {
                void handleAddPhoto(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
          </label>
        </div>
      )}

      {photoView && (
        <div
          className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/90 p-4"
          onClick={() => setPhotoView(null)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={photoView.data}
            alt="Unit note photo"
            className="max-h-[80vh] max-w-full rounded-lg object-contain"
          />
          <div className="mt-4 flex gap-3">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                void handleDeletePhoto(photoView.id);
              }}
              className="min-h-11 rounded-lg bg-red-600 px-4 text-sm font-medium text-white"
            >
              Delete photo
            </button>
            <button
              type="button"
              className="min-h-11 rounded-lg bg-neutral-700 px-4 text-sm font-medium text-white"
            >
              Close
            </button>
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {/* Room tag is optional — office/zone-run jobs (Alcon-style) enter
            dozens of untagged windows in walking order. */}
        <button
          type="button"
          onClick={() => selectTag("")}
          className={`min-h-11 rounded-full border border-dashed px-4 text-sm font-medium ${
            draft.tag_base === ""
              ? "border-blue-600 bg-blue-600 text-white"
              : "border-neutral-300 bg-white text-neutral-500 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-400"
          }`}
        >
          No tag
        </button>
        {(project?.tag_chips ?? []).map((tag) => (
          <button
            key={tag}
            type="button"
            onClick={() => selectTag(tag)}
            className={`min-h-11 rounded-full border px-4 text-sm font-medium ${
              draft.tag_base === tag
                ? "border-blue-600 bg-blue-600 text-white"
                : "border-neutral-300 bg-white text-neutral-700 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300"
            }`}
          >
            {tag}
          </button>
        ))}
      </div>
      {draft.tag_base !== null && (
        <div className="text-sm text-neutral-500">
          Will save as{" "}
          <span className="font-mono font-semibold text-neutral-900 dark:text-neutral-100">
            {draft.tag_base === "" ? unit.number : `${unit.number}-${previewLabel()}`}
          </span>
        </div>
      )}


      <div className="flex overflow-hidden rounded-lg border border-neutral-300 dark:border-neutral-700">
        <button
          type="button"
          onClick={() => setActiveField(typeof activeField === "number" ? activeField : 0)}
          className={`min-h-11 flex-1 text-sm font-medium ${
            !activeIsHeight ? "bg-blue-600 text-white" : "bg-white dark:bg-neutral-900"
          }`}
        >
          Width
        </button>
        <button
          type="button"
          onClick={() => setActiveField("height")}
          className={`min-h-11 flex-1 text-sm font-medium ${
            activeIsHeight ? "bg-blue-600 text-white" : "bg-white dark:bg-neutral-900"
          }`}
        >
          Height
        </button>
      </div>

      {!activeIsHeight && (
        <div className="flex flex-wrap items-center gap-2">
          {draft.widths.map((w, i) => (
            <div
              key={i}
              className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm ${
                activeField === i
                  ? "border-blue-600 bg-blue-50 dark:bg-blue-950"
                  : "border-neutral-300 dark:border-neutral-700"
              }`}
            >
              <button type="button" onClick={() => setActiveField(i)} className="font-mono">
                {formatFraction(floorToEighth(w))}
              </button>
              {draft.widths.length > 1 && (
                <button
                  type="button"
                  onClick={() => removePanel(i)}
                  aria-label={`Remove panel ${i + 1}`}
                  className="min-h-6 min-w-6 text-neutral-400"
                >
                  ×
                </button>
              )}
            </div>
          ))}
          <button
            type="button"
            onClick={addPanel}
            className="min-h-9 rounded-full bg-neutral-100 px-3 text-sm font-medium dark:bg-neutral-800"
          >
            + panel
          </button>
        </div>
      )}

      <Keypad
        // Remount (not just re-render) whenever the *target* changes — which
        // window is loaded, and which field/panel within it — so the keypad
        // always seeds its digit buffer fresh instead of reconciling stale
        // typing state against a different value (see Keypad's docstring).
        key={`${draftSeq}-${activeIsHeight ? "height" : `width-${activeField}`}`}
        valueSixteenths={activeIsHeight ? draft.height : (draft.widths[activeField as number] ?? 0)}
        onChange={(v) => (activeIsHeight ? patchDraft({ height: v }) : setPanelWidth(activeField as number, v))}
        precision={precision}
        onPrecisionChange={setPrecision}
      />

      <div className="flex flex-col gap-3 rounded-xl border border-neutral-200 p-3 dark:border-neutral-800">
        <div>
          <div className="mb-1 text-xs text-neutral-500">Deduct</div>
          <div className="flex overflow-hidden rounded-lg border border-neutral-300 dark:border-neutral-700">
            {DEDUCT_OPTIONS.map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => patchDraft({ deduct: draft.deduct === value ? null : value })}
                className={`min-h-11 flex-1 text-sm font-medium ${
                  draft.deduct === value ? "bg-blue-600 text-white" : "bg-white dark:bg-neutral-900"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          {draft.widths.length > 1 && draft.deduct && (
            <p className="mt-1 text-xs text-neutral-500">
              {draft.deduct === "D"
                ? "Bay: left edge comes off the left panel, right edge off the right panel — middle panels untouched."
                : draft.deduct === "Dl"
                  ? "Bay: comes off the left panel only."
                  : "Bay: comes off the right panel only."}
            </p>
          )}
        </div>

        <label className="flex min-h-11 items-center gap-3">
          <input
            type="checkbox"
            checked={draft.control_override === "L"}
            onChange={() => patchDraft({ control_override: draft.control_override === "L" ? null : "L" })}
            className="h-5 w-5"
          />
          <span className="text-sm">Left control</span>
        </label>

        <label className="flex min-h-11 items-center gap-3">
          <input
            type="checkbox"
            checked={draft.longer_chain}
            onChange={() => patchDraft({ longer_chain: !draft.longer_chain })}
            className="h-5 w-5"
          />
          <span className="text-sm">Longer chain</span>
        </label>

        <div className="flex min-h-11 items-center gap-3">
          <span className="text-sm">Quantity</span>
          <button
            type="button"
            onClick={() => patchDraft({ quantity: Math.max(1, draft.quantity - 1) })}
            className="min-h-11 min-w-11 rounded-lg bg-neutral-100 text-lg font-medium dark:bg-neutral-800"
            aria-label="Fewer"
          >
            −
          </button>
          <input
            type="text"
            inputMode="numeric"
            value={draft.quantity}
            onChange={(e) => {
              const v = e.target.value.replace(/\D/g, "");
              patchDraft({ quantity: v === "" ? 1 : Math.max(1, parseInt(v, 10)) });
            }}
            className="min-h-11 w-14 rounded-lg border border-neutral-300 text-center tabular-nums dark:border-neutral-700 dark:bg-neutral-900"
            aria-label="Quantity of identical blinds"
          />
          <button
            type="button"
            onClick={() => patchDraft({ quantity: draft.quantity + 1 })}
            className="min-h-11 min-w-11 rounded-lg bg-neutral-100 text-lg font-medium dark:bg-neutral-800"
            aria-label="More"
          >
            +
          </button>
          {draft.quantity > 1 && (
            <span className="text-xs text-neutral-500">identical blinds</span>
          )}
        </div>

        {noteOpen || draft.note ? (
          <div>
            <div className="mb-1 text-xs text-neutral-500">Note</div>
            <input
              type="text"
              value={draft.note}
              onChange={(e) => patchDraft({ note: e.target.value })}
              placeholder="e.g. corner reduction"
              className="min-h-11 w-full rounded-lg border border-neutral-300 px-3 text-sm dark:border-neutral-700 dark:bg-neutral-900"
            />
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setNoteOpen(true)}
            className="min-h-9 self-start rounded-lg bg-neutral-100 px-3 text-sm font-medium dark:bg-neutral-800"
          >
            + Note
          </button>
        )}
      </div>

      {error && <div className="text-sm text-red-600">{error}</div>}

      <div className="sticky bottom-3 z-20 -mx-1 px-1">
        <button
          type="button"
          onClick={handleSaveNext}
          aria-live="polite"
          className={`min-h-14 w-full rounded-xl text-base font-semibold text-white shadow-lg transition-colors ${
            justSaved ? "bg-green-600" : "bg-blue-600 active:bg-blue-700"
          }`}
        >
          {justSaved ? "✓ Saved" : "Save · next window"}
        </button>
      </div>

      <div className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold text-neutral-500">This unit&apos;s windows</h2>
        {windowWarnings.size > 0 && (
          <div className="rounded-lg border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">
            ⚠️ {windowWarnings.size} measurement{windowWarnings.size === 1 ? "" : "s"} flagged
            below — tap Edit to fix, or ignore if it&apos;s really like that.
          </div>
        )}
        {windows.length === 0 && <div className="text-sm text-neutral-400">None yet.</div>}
        {windows.map((w) => (
          <div
            key={w.id}
            className={`flex flex-col gap-1 rounded-lg border p-3 text-sm ${
              windowWarnings.has(w.id)
                ? "border-amber-400 bg-amber-50 dark:border-amber-600 dark:bg-amber-950/40"
                : draft.id === w.id
                  ? "border-blue-600"
                  : "border-neutral-200 dark:border-neutral-800"
            }`}
          >
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center gap-1.5 font-medium">
                {displayLabelFor(w)}
                {w.deduct && (
                  <span className="rounded bg-blue-50 px-1.5 py-0.5 text-[10px] font-semibold text-blue-700 dark:bg-blue-950 dark:text-blue-300">
                    {w.deduct}
                  </span>
                )}
                {w.control_override === "L" && (
                  <span className="rounded bg-purple-50 px-1.5 py-0.5 text-[10px] font-semibold text-purple-700 dark:bg-purple-950 dark:text-purple-300">
                    LC
                  </span>
                )}
                {w.longer_chain && (
                  <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] font-semibold text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">
                    CH
                  </span>
                )}
              </div>
              <div className="text-neutral-500">
                {w.widths.map((width) => formatFraction(floorToEighth(width))).join(" + ")} ×{" "}
                {formatFraction(floorToEighth(w.height))}
                {(w.quantity ?? 1) > 1 && (
                  <span className="ml-1.5 rounded bg-blue-50 px-1.5 py-0.5 text-[10px] font-semibold text-blue-700 dark:bg-blue-950 dark:text-blue-300">
                    ×{w.quantity}
                  </span>
                )}
              </div>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => loadForEdit(w)}
                className="min-h-9 rounded-lg bg-neutral-100 px-3 text-xs font-medium dark:bg-neutral-800"
              >
                Edit
              </button>
              <button
                type="button"
                onClick={() => handleDeleteWindow(w.id)}
                className="min-h-9 rounded-lg bg-red-50 px-3 text-xs font-medium text-red-600 dark:bg-red-950"
              >
                Delete
              </button>
            </div>
          </div>
          {windowWarnings.has(w.id) && (
            <div className="text-xs font-medium text-amber-800 dark:text-amber-300">
              ⚠️ {windowWarnings.get(w.id)}
            </div>
          )}
          </div>
        ))}
      </div>
    </main>
  );
}

