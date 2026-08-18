"use client";

// React glue for export history. Kept beside the export code (rather than in
// a component) so both the floor screen's "changes since" line and the export
// button's review sheet read the same record from one query.
import { useCallback, useEffect, useMemo, useState } from "react";
import { latestExport } from "../db";
import type { ExportRecord } from "../types";
import { diffExports, summarizeDiff, type ExportDiff } from "./diff";
import type { ExportInput } from "./shared";

export interface ExportHistoryState {
  last: ExportRecord | null;
  /** Diff of `current` against the last export; null until both are known. */
  diff: ExportDiff | null;
  /** e.g. "3 changed, 1 added since"; null when never exported. */
  summary: string | null;
  loading: boolean;
  refresh: () => void;
}

export function useExportHistory(
  floorId: string | undefined,
  current: ExportInput | null
): ExportHistoryState {
  // One state object holding the floor it was loaded for, so a floor change
  // never flashes the previous floor's export line while the new one loads,
  // and so nothing is set synchronously inside the effect body.
  const [loaded, setLoaded] = useState<{ floorId?: string; last: ExportRecord | null }>({
    last: null,
  });
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const record = floorId ? await latestExport(floorId) : undefined;
      if (!cancelled) setLoaded({ floorId, last: record ?? null });
    })();
    return () => {
      cancelled = true;
    };
  }, [floorId, nonce]);

  const fresh = loaded.floorId === floorId;
  const last = fresh ? loaded.last : null;

  const diff = useMemo(() => {
    if (!last?.input || !current) return null;
    return diffExports(last.input, current);
  }, [last, current]);

  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  return {
    last,
    diff,
    summary: diff ? summarizeDiff(diff) : null,
    loading: !fresh,
    refresh,
  };
}

/** "Aug 12" / "Aug 12, 2025" once it's not this year. */
export function formatExportDate(iso: string): string {
  const d = new Date(iso);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}
