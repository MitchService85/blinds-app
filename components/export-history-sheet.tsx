"use client";

import { useEffect, useState } from "react";
import { listExports } from "@/lib/db";
import { deliverFile } from "@/lib/export/deliver";
import { formatExportDate } from "@/lib/export/history";
import type { ExportRecord } from "@/lib/types";

/**
 * A floor's past exports, newest first, each re-downloadable.
 *
 * Re-download regenerates the workbook from that record's stored ExportInput
 * rather than from current data, so "what did we send on the 12th?" returns
 * the file as it was sent, not the file we would send today. That is the
 * whole reason the snapshot is the input and not the .xlsx bytes.
 */
export function ExportHistorySheet({
  floorId,
  onClose,
}: {
  floorId: string;
  onClose: () => void;
}) {
  const [records, setRecords] = useState<ExportRecord[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void listExports(floorId).then((rows) => {
      if (!cancelled) setRecords(rows);
    });
    return () => {
      cancelled = true;
    };
  }, [floorId]);

  async function redownload(record: ExportRecord) {
    setBusyId(record.id);
    try {
      const mod = await import("@/lib/export/exporter").catch(() => null);
      if (!mod?.exportFloorToBlob) return;
      const blob = await mod.exportFloorToBlob(record.input);
      await deliverFile(blob, record.filename);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center"
      onClick={onClose}
    >
      <div
        className="flex max-h-[80vh] w-full max-w-sm flex-col rounded-xl bg-white p-4 dark:bg-neutral-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-1 text-sm font-semibold">Export history</div>
        <p className="mb-3 text-xs text-neutral-500 dark:text-neutral-400">
          Each entry re-downloads exactly as it was exported, not as the floor
          reads today.
        </p>

        <div className="mb-4 flex-1 overflow-y-auto">
          {records === null && (
            <p className="text-sm text-neutral-500 dark:text-neutral-400">Loading…</p>
          )}
          {records?.length === 0 && (
            <p className="text-sm text-neutral-500 dark:text-neutral-400">
              This floor has not been exported yet.
            </p>
          )}
          <ul className="flex flex-col gap-2">
            {records?.map((r) => (
              <li
                key={r.id}
                className="flex items-center gap-3 rounded-lg border border-neutral-200 p-2.5 dark:border-neutral-800"
              >
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">{formatExportDate(r.exported_at)}</div>
                  <div className="truncate text-xs text-neutral-500 dark:text-neutral-400">
                    {r.blind_count} blind{r.blind_count === 1 ? "" : "s"} · {r.filename}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => void redownload(r)}
                  disabled={busyId === r.id}
                  className="min-h-9 shrink-0 rounded-lg bg-neutral-100 px-3 text-xs font-medium disabled:opacity-60 dark:bg-neutral-800"
                >
                  {busyId === r.id ? "…" : "Get file"}
                </button>
              </li>
            ))}
          </ul>
        </div>

        <button
          type="button"
          onClick={onClose}
          className="min-h-11 rounded-lg bg-neutral-100 text-sm font-medium dark:bg-neutral-800"
        >
          Close
        </button>
      </div>
    </div>
  );
}
