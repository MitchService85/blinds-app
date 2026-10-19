// The two signals between the local store, the sync loop and the screens.
//
// Lives apart from lib/sync on purpose: lib/db.ts must announce a write
// without importing the sync module (which imports lib/db.ts), and a screen
// must hear about pulled rows without loading Supabase.
import { useEffect, useState } from "react";

const LOCAL_WRITE = "measure:local-write";
const REMOTE_CHANGE = "measure:remote-change";

/** A row was written on this device and queued to push. */
export function notifyLocalWrite(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(LOCAL_WRITE));
}

export function onLocalWrite(handler: () => void): () => void {
  window.addEventListener(LOCAL_WRITE, handler);
  return () => window.removeEventListener(LOCAL_WRITE, handler);
}

/** Rows from another device landed in these tables. */
export function notifyRemoteChange(tables: string[]): void {
  if (typeof window === "undefined" || tables.length === 0) return;
  window.dispatchEvent(new CustomEvent(REMOTE_CHANGE, { detail: tables }));
}

/** Someone is typing: a text field has focus. */
function typing(): boolean {
  const el = document.activeElement;
  if (!el) return false;
  if (el instanceof HTMLTextAreaElement) return true;
  if (el instanceof HTMLInputElement) {
    return !["checkbox", "radio", "button", "submit"].includes(el.type);
  }
  return (el as HTMLElement).isContentEditable === true;
}

/**
 * A number that goes up whenever another device's changes to any of these
 * tables arrive. Put it in a load effect's dependencies and the screen
 * redraws with them — without it a screen shows what was there when it
 * opened, and the crew had to quit and reopen the app to see each other's
 * work (2026-10-19).
 *
 * Held back while a text field has focus and applied when it loses it, so a
 * reload never lands mid-word and reverts what is being typed.
 */
export function useRemoteVersion(tables: readonly string[]): number {
  const [version, setVersion] = useState(0);
  const key = tables.join(",");
  useEffect(() => {
    const watched = new Set(key.split(","));
    let waiting = false;
    const bump = () => setVersion((v) => v + 1);
    const onBlur = () => {
      // focusout fires before focus moves on; check once it has settled.
      setTimeout(() => {
        if (waiting && !typing()) {
          waiting = false;
          bump();
        }
      }, 0);
    };
    const onChange = (e: Event) => {
      const changed = (e as CustomEvent<string[]>).detail ?? [];
      if (!changed.some((t) => watched.has(t))) return;
      if (typing()) waiting = true;
      else bump();
    };
    window.addEventListener(REMOTE_CHANGE, onChange);
    document.addEventListener("focusout", onBlur);
    return () => {
      window.removeEventListener(REMOTE_CHANGE, onChange);
      document.removeEventListener("focusout", onBlur);
    };
  }, [key]);
  return version;
}
