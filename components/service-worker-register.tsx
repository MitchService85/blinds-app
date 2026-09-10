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

  // The app paints edge-to-edge (viewportFit: cover, so the top bars can pad
  // for the notch), which means a fixed top element with no inset sits UNDER
  // the iOS status bar: the banner rendered behind the clock, and its Reload
  // button could not be pressed (2026-09-10). Pad by the inset; the blue
  // still runs up behind the status bar, the words and button sit below it.
  return (
    <div className="fixed inset-x-0 top-0 z-50 flex items-center justify-between gap-3 bg-blue-600 px-4 pb-2 pt-[calc(env(safe-area-inset-top,0px)+0.5rem)] text-sm text-white shadow">
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
