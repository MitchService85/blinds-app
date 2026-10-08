"use client";

import { useEffect, useState, useSyncExternalStore } from "react";

/** The page's own build never changes while it is open. */
const subscribeNever = () => () => {};
const readSha = () => document.documentElement.dataset.build ?? null;
const readVersion = () => document.documentElement.dataset.version ?? null;
const readNothing = () => null;

type Latest =
  | { state: "checking" }
  | { state: "known"; sha: string; version: string | null }
  | { state: "offline" };

/**
 * "Version v1.4 · Up to date", at the foot of Settings.
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
 *
 * The friendly version ("v1.4") is what a person reads out; the commit is
 * what decides "up to date". A release that missed its version bump still
 * shows as newer, with its commit beside the repeated number, rather than
 * passing for the build you already have.
 */
export function BuildStamp() {
  const sha = useSyncExternalStore(subscribeNever, readSha, readNothing);
  const version = useSyncExternalStore(subscribeNever, readVersion, readNothing);
  const [latest, setLatest] = useState<Latest>({ state: "checking" });

  useEffect(() => {
    let cancelled = false;
    fetch("/build.json", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((body: { sha?: unknown; version?: unknown }) => {
        if (cancelled) return;
        setLatest(
          typeof body.sha === "string"
            ? { state: "known", sha: body.sha, version: typeof body.version === "string" ? body.version : null }
            : { state: "offline" }
        );
      })
      .catch(() => {
        if (!cancelled) setLatest({ state: "offline" });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!sha) return null;
  const behind = latest.state === "known" && latest.sha !== sha;
  // Same number, different build: someone released without bumping. Say
  // which build, so the two can't be mistaken for each other.
  const newerLabel =
    latest.state !== "known"
      ? ""
      : latest.version && latest.version !== version
        ? latest.version
        : `${latest.version ?? ""} (${latest.sha})`.trim();

  return (
    <div className="flex flex-col items-center gap-1 py-2 text-xs text-neutral-500 dark:text-neutral-400">
      <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1">
        <span>
          Version <span className="font-semibold text-neutral-700 dark:text-neutral-200">{version ?? sha}</span>
        </span>
        {latest.state === "known" && !behind && <span>· Up to date</span>}
        {latest.state === "offline" && <span>· Can&apos;t check (offline)</span>}
        {behind && (
          <>
            <span className="font-medium text-amber-700 dark:text-amber-300">
              · {newerLabel} is available
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
      {/* The commit, small: what I need when a screenshot comes back. */}
      {version && <span className="font-mono text-[10px] opacity-70">build {sha}</span>}
    </div>
  );
}
