"use client";

import { useSyncStatus } from "@/lib/sync";

const STATE_LABEL: Record<string, string> = {
  "local-only": "local only",
  synced: "✓ synced",
  offline: "offline — will sync",
  error: "sync error",
};

/**
 * Only ever loaded via a dynamic import from SyncStatus (see sync-status.tsx)
 * so a build without lib/sync/ never has to resolve this module's static
 * `useSyncStatus` import at all.
 */
export function SyncStatusInner() {
  const status = useSyncStatus();
  const label =
    status.state === "pending"
      ? `${status.pendingCount} pending`
      : (STATE_LABEL[status.state] ?? status.state);

  return <span className="text-xs text-neutral-500 dark:text-neutral-400">{label}</span>;
}
