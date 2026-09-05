"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Served by app/sw.js/route.ts with a per-deploy build id baked in, so the
 * browser sees genuinely different bytes after each deploy — which is what
 * makes updatefound (and so the update banner) fire at all.
 */
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
  const userRequestedReloadRef = useRef(false);

  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) {
      return;
    }

    // Never run the service worker against the dev server: it intercepts
    // HMR/dev requests and Turbopack responds with hard reloads, producing an
    // infinite reload loop. Also unregister any worker left over from a
    // previous production visit on this origin.
    if (process.env.NODE_ENV !== "production") {
      navigator.serviceWorker.getRegistrations().then((regs) => {
        for (const reg of regs) reg.unregister();
      });
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
      // updateViaCache "none": the worker script must be revalidated against
      // the network, never served from the browser's HTTP cache.
      .register(SW_URL, { updateViaCache: "none" })
      .then((registration) => {
        if (registration.waiting && navigator.serviceWorker.controller) {
          waitingWorkerRef.current = registration.waiting;
          if (!cancelled) setUpdateAvailable(true);
        }
        // This register() call can itself start the update, in which case
        // updatefound has already fired by the time this callback runs — so
        // adopt an in-flight install as well as listening for the next one.
        watchInstalling(registration);
        registration.addEventListener("updatefound", () => watchInstalling(registration));
      })
      .catch((err) => {
        console.error("[sw] registration failed", err);
      });

    let reloading = false;
    const onControllerChange = () => {
      // Only reload when the user explicitly accepted the update via
      // reload(); the first-install claim also fires controllerchange and
      // must never yank the page out from under an entry session.
      if (reloading || !userRequestedReloadRef.current) return;
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
    userRequestedReloadRef.current = true;
    const worker = waitingWorkerRef.current;
    if (worker) {
      worker.postMessage({ type: "SKIP_WAITING" });
    } else {
      window.location.reload();
    }
  }, []);

  return { updateAvailable, reload };
}
