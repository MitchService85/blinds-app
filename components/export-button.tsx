"use client";

import { sortUnitsForDisplay } from "@/lib/unit-sort";
import { useState } from "react";
import type { Floor, Unit, WindowRecord } from "@/lib/types";
import { checkFloor, type MeasurementWarning } from "@/lib/checks";

interface ExportButtonProps {
  projectName: string;
  floor: Floor;
  units: Unit[];
  windowsByUnit: Map<string, WindowRecord[]>;
}

/**
 * Exports the current floor to the factory .xlsx (see spec: Export). Loads
 * lib/export/exporter via dynamic import and disables itself if the module
 * or its exportFloorToBlob export isn't available in this build, rather than
 * crashing — exporter.ts is owned by a different concurrent agent.
 *
 * Also runs lib/checks.ts's bay-symmetry sanity check first: warnings are
 * shown in a confirm sheet ("Export anyway" / "Cancel") but never block the
 * export outright — the floor grid already keeps a persistent ⚠ badge on
 * flagged units regardless of what happens here.
 */
export function ExportButton({ projectName, floor, units, windowsByUnit }: ExportButtonProps) {
  const [busy, setBusy] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [pendingWarnings, setPendingWarnings] = useState<MeasurementWarning[] | null>(null);

  function handleExportClick() {
    const exportableUnits = units.filter((u) => u.status !== "na");
    const totalWindows = exportableUnits.reduce(
      (sum, u) => sum + (windowsByUnit.get(u.id)?.length ?? 0),
      0
    );

    if (totalWindows === 0) {
      const proceed = window.confirm(
        "This floor has no windows yet. Export an empty file anyway?"
      );
      if (!proceed) return;
    }

    const warnings = checkFloor(
      exportableUnits.map((u) => ({ unit: u, windows: windowsByUnit.get(u.id) ?? [] }))
    );
    if (warnings.length > 0) {
      setPendingWarnings(warnings);
      return;
    }

    void performExport();
  }

  async function performExport() {
    setBusy(true);
    try {
      const mod = await import("@/lib/export/exporter").catch(() => null);
      if (!mod || typeof mod.exportFloorToBlob !== "function") {
        setUnavailable(true);
        return;
      }

      const input = {
        project_name: projectName,
        floor_label: floor.label,
        export_date: new Date().toISOString().slice(0, 10),
        defaults: floor.defaults,
        units: sortUnitsForDisplay(units)
          .map((u) => ({
            number: u.number,
            status: u.status,
            windows: (windowsByUnit.get(u.id) ?? [])
              .slice()
              .sort((a, b) => a.sort_order - b.sort_order)
              .map((w) => ({
                tag_base: w.tag_base,
                tag_index: w.tag_index,
                widths: w.widths,
                height: w.height,
                control_override: w.control_override,
                mount_override: w.mount_override ?? null,
                deduct: w.deduct,
                longer_chain: w.longer_chain,
                note: w.note,
              })),
          })),
      };

      const blob = await mod.exportFloorToBlob(input);
      const filename =
        typeof mod.suggestedFilename === "function"
          ? mod.suggestedFilename({ project_name: projectName, floor_label: floor.label })
          : `${projectName} - ${floor.label}.xlsx`;

      await deliverFile(blob, filename);
    } finally {
      setBusy(false);
    }
  }

  if (unavailable) {
    return (
      <button
        type="button"
        disabled
        className="min-h-12 rounded-lg bg-neutral-200 px-4 text-sm font-medium text-neutral-400 dark:bg-neutral-800 dark:text-neutral-600"
      >
        Export unavailable
      </button>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={handleExportClick}
        disabled={busy}
        className="min-h-12 rounded-lg bg-neutral-800 px-4 text-sm font-medium text-white active:bg-neutral-700 disabled:opacity-60 dark:bg-neutral-100 dark:text-neutral-900"
      >
        {busy ? "Exporting…" : "Export"}
      </button>

      {pendingWarnings && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center"
          onClick={() => setPendingWarnings(null)}
        >
          <div
            className="w-full max-w-sm rounded-xl bg-white p-4 dark:bg-neutral-900"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-2 text-sm font-semibold">Check these before exporting</div>
            <ul className="mb-4 flex max-h-56 flex-col gap-2 overflow-y-auto text-sm text-amber-800 dark:text-amber-300">
              {pendingWarnings.map((w) => (
                <li key={w.window_id}>
                  ⚠ {w.unit_number}-{w.tag}: {w.message}
                </li>
              ))}
            </ul>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setPendingWarnings(null)}
                className="min-h-11 flex-1 rounded-lg bg-neutral-100 text-sm font-medium dark:bg-neutral-800"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  setPendingWarnings(null);
                  void performExport();
                }}
                className="min-h-11 flex-1 rounded-lg bg-blue-600 text-sm font-semibold text-white"
              >
                Export anyway
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

async function deliverFile(blob: Blob, filename: string): Promise<void> {
  const file = new File([blob], filename, { type: blob.type });
  const nav = navigator as Navigator & {
    canShare?: (data: { files: File[] }) => boolean;
    share?: (data: { files: File[] }) => Promise<void>;
  };

  if (nav.share && nav.canShare?.({ files: [file] })) {
    try {
      // Files only — passing `title`/`text` makes iOS attach a second, useless
      // .txt item alongside the workbook in the share sheet.
      await nav.share({ files: [file] });
      return;
    } catch {
      // User cancelled the share sheet, or it failed — fall back to download.
    }
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
