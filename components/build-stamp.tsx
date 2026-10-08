"use client";

import { useEffect, useState, useSyncExternalStore } from "react";

/** The page's own build never changes while it is open. */
const subscribeNever = () => () => {};
const readRunning = () => document.documentElement.dataset.build ?? null;
const readNothing = () => null;

type Latest = { state: "checking" } | { state: "known"; sha: string } | { state: "offline" };

/**
 * "Version abc1234 · Up to date", at the foot of Settings.
 *
 * Exists because a day went to "is your phone on the new build or the old
 * one?" (2026-10-06): three rounds of a bottom-bar fix were judged against a
 * phone that may not have loaded them, with no way to tell from either end.
 *
 * Two different questions, answered separately:
 *   - what THIS PHONE is running: stamped onto <html> by the server when the
 *     page was loaded (app/layout.tsx), so it is the build behind every
 *     screen in this tab, not whatever the server has moved on to since;
 *   - what the SERVER is on now: /build.json, asked fresh.
 * When they differ, the phone is behind and a reload fixes it.
 */
export function BuildStamp() {
  const running = useSyncExternalStore(subscribeNever, readRunning, readNothing);
  const [latest, setLatest] = useState<Latest>({ state: "checking" });

  useEffect(() => {
    let cancelled = false;
    fetch("/build.json", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((body: { sha?: unknown }) => {
        if (cancelled) return;
        setLatest(typeof body.sha === "string" ? { state: "known", sha: body.sha } : { state: "offline" });
      })
      .catch(() => {
        if (!cancelled) setLatest({ state: "offline" });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!running) return null;
  const behind = latest.state === "known" && latest.sha !== running;

  return (
    <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 py-2 text-xs text-neutral-500 dark:text-neutral-400">
      <span>
        Version <span className="font-mono">{running}</span>
      </span>
      {latest.state === "known" && !behind && <span>· Up to date</span>}
      {latest.state === "offline" && <span>· Can&apos;t check (offline)</span>}
      {behind && (
        <>
          <span className="font-medium text-amber-700 dark:text-amber-300">
            · Newer version <span className="font-mono">{latest.sha}</span> available
          </span>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="min-h-9 rounded-md bg-blue-600 px-3 font-semibold text-white active:bg-blue-700"
          >
            Reload
          </button>
        </>
      )}
    </div>
  );
}
