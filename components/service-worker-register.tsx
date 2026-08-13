"use client";

import { useServiceWorkerUpdate } from "@/lib/sw";

/**
 * Registers the app's service worker on mount and shows a fixed banner when
 * a new deploy has finished installing behind the active one — so a new
 * version never silently goes unnoticed behind a stale cached shell (see
 * spec: "Update banner when useServiceWorkerUpdate reports one").
 */
export function ServiceWorkerRegister() {
  const { updateAvailable, reload } = useServiceWorkerUpdate();

  if (!updateAvailable) return null;

  return (
    <div className="fixed inset-x-0 top-0 z-50 flex items-center justify-between gap-3 bg-blue-600 px-4 py-2 text-sm text-white shadow">
      <span>A new version is ready.</span>
      <button
        type="button"
        onClick={reload}
        className="min-h-9 shrink-0 rounded-md bg-white/20 px-3 font-medium active:bg-white/30"
      >
        Reload
      </button>
    </div>
  );
}
