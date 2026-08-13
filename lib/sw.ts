"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const SW_URL = "/sw.js";

export interface ServiceWorkerUpdateState {
  /** True once a new service worker has installed behind the active one. */
  updateAvailable: boolean;
  /** Activate the waiting worker and reload the page onto it. */
  reload: () => void;
}

/**
 * Registers the app's service worker on mount and tracks whether a new
 * deployment has finished installing in the background. Phase 2's UI shows
 * an "update available" banner driven by `updateAvailable` and wires its
 * button to `reload()` — this exists so a new deploy never silently goes
 * unnoticed behind a stale cached shell (see spec: PWA basics).
 */
export function useServiceWorkerUpdate(): ServiceWorkerUpdateState {
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const waitingWorkerRef = useRef<ServiceWorker | null>(null);

  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) {
      return;
    }

    let cancelled = false;

    const watchInstalling = (registration: ServiceWorkerRegistration) => {
      const installing = registration.installing;
      if (!installing) return;
      installing.addEventListener("statechange", () => {
        if (installing.state === "installed" && navigator.serviceWorker.controller) {
          // A previous worker already controls this page, so this is a
          // genuine update — not the very first install.
          waitingWorkerRef.current = installing;
          if (!cancelled) setUpdateAvailable(true);
        }
      });
    };

    navigator.serviceWorker
      .register(SW_URL)
      .then((registration) => {
        if (registration.waiting && navigator.serviceWorker.controller) {
          waitingWorkerRef.current = registration.waiting;
          if (!cancelled) setUpdateAvailable(true);
        }
        registration.addEventListener("updatefound", () => watchInstalling(registration));
      })
      .catch((err) => {
        console.error("[sw] registration failed", err);
      });

    let reloading = false;
    const onControllerChange = () => {
      if (reloading) return;
      reloading = true;
      window.location.reload();
    };
    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);

    return () => {
      cancelled = true;
      navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
    };
  }, []);

  const reload = useCallback(() => {
    const worker = waitingWorkerRef.current;
    if (worker) {
      worker.postMessage({ type: "SKIP_WAITING" });
    } else {
      window.location.reload();
    }
  }, []);

  return { updateAvailable, reload };
}
