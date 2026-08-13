/**
 * Best-effort "sync now" used by Save & exit (see spec: Autosave and sync —
 * "Save & exit ... force a sync attempt"). Dynamically imports lib/sync so
 * this file (and anything importing it) still compiles/builds even on a
 * checkout where lib/sync/ isn't present yet; a missing or failing sync
 * module is silently a no-op, matching "never surface as blocking errors."
 */
export async function triggerSyncIfAvailable(): Promise<void> {
  try {
    const mod = await import("@/lib/sync");
    if (typeof mod.forceSync === "function") {
      await mod.forceSync();
    }
  } catch {
    // lib/sync not present, or the sync attempt itself failed — either way
    // this is a fire-and-forget nicety, not something to block navigation on.
  }
}
