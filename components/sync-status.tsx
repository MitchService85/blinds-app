"use client";

import { useEffect, useState, type ComponentType } from "react";

/**
 * Always-visible sync status line (see spec: "Status indicator, always
 * visible"). Loads its real implementation (which statically imports
 * lib/sync's useSyncStatus hook) via a dynamic import so this component —
 * and anything that renders it — still builds and renders even when
 * lib/sync/ doesn't exist in this checkout, falling back to "local only".
 */
export function SyncStatus() {
  const [Inner, setInner] = useState<ComponentType | null>(null);

  useEffect(() => {
    let cancelled = false;
    import("./sync-status-inner")
      .then((mod) => {
        if (!cancelled) setInner(() => mod.SyncStatusInner);
      })
      .catch(() => {
        // lib/sync not present in this build — fall through to "local only".
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (Inner) return <Inner />;
  return <span className="text-xs text-neutral-500 dark:text-neutral-400">local only</span>;
}
