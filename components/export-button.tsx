"use client";

import { useMemo, useState } from "react";
import type { Floor, Unit, WindowRecord } from "@/lib/types";
import { checkFloor, type MeasurementWarning } from "@/lib/checks";
import { buildExportInput, countBlinds, localDateISO } from "@/lib/export/build-input";
import { deliverFile } from "@/lib/export/deliver";
import { createExportRecord, latestExport } from "@/lib/db";
import { formatExportDate, useExportHistory } from "@/lib/export/history";
import { diffExports } from "@/lib/export/diff";
import type { ExportDiff, WindowChange } from "@/lib/export/diff";
import type { ExportInput } from "@/lib/export/shared";
import { ExportHistorySheet } from "./export-history-sheet";

interface ExportButtonProps {
  projectName: string;
  floor: Floor;
  units: Unit[];
  windowsByUnit: Map<string, WindowRecord[]>;
  /** Called after a workbook is generated and recorded, so the floor can refresh. */
  onExported?: () => void;
}

/**
 * Exports the current floor to the factory .xlsx (see spec: Export). Loads
 * lib/export/exporter via dynamic import and disables itself if the module
 * or its exportFloorToBlob export isn't available in this build, rather than
 * crashing.
 *
 * Two things gate the export, shown together in one review sheet rather than
 * as consecutive prompts:
 *   - lib/checks.ts warnings (bay symmetry, implausible values)
 *   - what changed since this floor was last exported (lib/export/diff.ts)
 * Neither blocks: the sheet always offers "Export anyway".
 *
 * On success the ExportInput is snapshotted to the exports table, which is
 * what makes the next diff (and re-downloading this exact file) possible.
 */
export function ExportButton({
  projectName,
  floor,
  units,
  windowsByUnit,
  onExported,
}: ExportButtonProps) {
  const [busy, setBusy] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [review, setReview] = useState<{
    warnings: MeasurementWarning[];
    diff: ExportDiff | null;
  } | null>(null);

  // Keyed on the pieces the export actually reads, not on floor object
  // identity: typing in the order-number field replaces the floor object
  // twice per keystroke, and rebuilding + diffing a 100-window input on each
  // was measurable lag. defaults/label only change in the Edit sheet.
  const input = useMemo(
    () => buildExportInput({ projectName, floor, units, windowsByUnit }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [projectName, floor.id, floor.label, floor.defaults, units, windowsByUnit]
  );
  const history = useExportHistory(floor.id, input);

  async function handleExportClick() {
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
      exportableUnits.map((u) => ({ unit: u, windows: windowsByUnit.get(u.id) ?? [] })),
      floor.defaults
    );
    // The hook's diff is null while the history read is in flight; treating
    // that as "no changes" would skip the review sheet on a fast tap. Ask the
    // store directly when the hook hasn't resolved yet.
    let resolved = history.diff;
    if (resolved === null && history.loading) {
      const last = await latestExport(floor.id);
      if (last?.input) resolved = diffExports(last.input, input);
    }
    const diff = resolved && !resolved.identical ? resolved : null;

    if (warnings.length > 0 || diff) {
      setReview({ warnings, diff });
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

      // Re-stamp the date at the moment of export: the memoized input can be
      // hours old in a PWA left open overnight.
      const snapshot: ExportInput = { ...input, export_date: localDateISO() };
      const blob = await mod.exportFloorToBlob(snapshot);
      const filename =
        typeof mod.suggestedFilename === "function"
          ? mod.suggestedFilename({ project_name: projectName, floor_label: floor.label })
          : `${projectName} - ${floor.label}.xlsx`;

      // Record before delivering: the share sheet can be cancelled and we
      // can't tell, so the history says "Exported", never "Sent". Better a
      // recorded export the crew ignored than a sent file with no record.
      await createExportRecord({
        floor_id: floor.id,
        exported_at: new Date().toISOString(),
        filename,
        blind_count: countBlinds(snapshot),
        input: snapshot,
      });
      history.refresh();
      onExported?.();

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
      <div className="flex flex-col items-stretch">
        <button
          type="button"
          onClick={handleExportClick}
          disabled={busy}
          className="min-h-12 rounded-lg bg-neutral-800 px-4 text-sm font-medium text-white active:bg-neutral-700 disabled:opacity-60 dark:bg-neutral-100 dark:text-neutral-900"
        >
          {busy ? "Exporting…" : "Export"}
        </button>
        {history.last && (
          <button
            type="button"
            onClick={() => setHistoryOpen(true)}
            className="mt-1 text-center text-[11px] leading-tight text-neutral-500 underline decoration-dotted underline-offset-2 dark:text-neutral-400"
          >
            Last {formatExportDate(history.last.exported_at)}
            {history.summary ? `, ${history.summary}` : ""}
          </button>
        )}
      </div>

      {historyOpen && (
        <ExportHistorySheet floorId={floor.id} onClose={() => setHistoryOpen(false)} />
      )}

      {review && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center"
          onClick={() => setReview(null)}
        >
          <div
            className="flex max-h-[80vh] w-full max-w-sm flex-col rounded-xl bg-white p-4 dark:bg-neutral-900"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-2 text-sm font-semibold">Review before exporting</div>

            <div className="mb-4 flex-1 overflow-y-auto">
              {review.diff && (
                <ChangeList diff={review.diff} since={history.last?.exported_at} />
              )}

              {review.warnings.length > 0 && (
                <>
                  <div className="mb-1 mt-3 text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
                    Check these
                  </div>
                  <ul className="flex flex-col gap-2 text-sm text-amber-800 dark:text-amber-300">
                    {review.warnings.map((w) => (
                      <li key={w.window_id}>
                        ⚠ {w.unit_number}-{w.tag}: {w.message}
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setReview(null)}
                className="min-h-11 flex-1 rounded-lg bg-neutral-100 text-sm font-medium dark:bg-neutral-800"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  setReview(null);
                  void performExport();
                }}
                className="min-h-11 flex-1 rounded-lg bg-blue-600 text-sm font-semibold text-white"
              >
                Export
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

const KIND_MARK: Record<WindowChange["kind"], string> = {
  added: "+",
  removed: "−",
  changed: "•",
};

function ChangeList({ diff, since }: { diff: ExportDiff; since?: string }) {
  return (
    <>
      <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
        Changed since {since ? formatExportDate(since) : "last export"}
      </div>

      {diff.floor.length > 0 && (
        <div className="mb-2 rounded-lg bg-amber-50 p-2 text-sm dark:bg-amber-950/40">
          <div className="mb-1 text-xs font-medium text-amber-900 dark:text-amber-200">
            Floor settings — these change every blind
          </div>
          <ul className="flex flex-col gap-0.5">
            {diff.floor.map((f) => (
              <li key={f.label} className="text-[13px] text-amber-900 dark:text-amber-200">
                {f.label}: {f.from} → {f.to}
              </li>
            ))}
          </ul>
        </div>
      )}

      <ul className="flex flex-col gap-1.5 text-sm">
        {diff.windows.map((w, i) => (
          <li key={`${w.unit_number}-${w.tag}-${w.kind}-${i}`}>
            <span className="font-medium">
              {KIND_MARK[w.kind]} {w.unit_number}
              {w.tag ? `-${w.tag}` : ""}
            </span>
            {w.kind === "added" && (
              <span className="text-neutral-500 dark:text-neutral-400"> added</span>
            )}
            {w.kind === "removed" && (
              <span className="text-neutral-500 dark:text-neutral-400"> no longer exported</span>
            )}
            {w.fields.length > 0 && (
              <ul className="ml-4 flex flex-col text-[13px] text-neutral-600 dark:text-neutral-400">
                {w.fields.map((f) => (
                  <li key={f.label}>
                    {f.label}: {f.from} → {f.to}
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}


