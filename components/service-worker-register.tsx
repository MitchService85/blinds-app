"use client";

import { useServiceWorkerUpdate } from "@/lib/sw";

/**
 * Registers the app's service worker on mount. Renders nothing — Phase 2
 * adds the visible "update available" banner on top of this same hook.
 */
export function ServiceWorkerRegister() {
  useServiceWorkerUpdate();
  return null;
}
