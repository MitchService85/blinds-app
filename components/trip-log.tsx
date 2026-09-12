"use client";

import { useCallback, useEffect, useState } from "react";
import { createTrip, deleteTrip, listTrips, updateTrip } from "@/lib/db";
import { triggerSyncIfAvailable } from "@/components/trigger-sync";
import { Icon } from "@/components/icon";
import type { Trip, TripPurpose } from "@/lib/types";

/** The four reasons a van goes to site, in the order they happen on a job. */
const PURPOSES: Array<[TripPurpose, string]> = [
  ["measure", "Measure"],
  ["install", "Install"],
  ["revisit", "Revisit"],
  ["other", "Other"],
];

export const TRIP_PURPOSE_LABEL: Record<TripPurpose, string> = {
  measure: "Measure",
  install: "Install",
  revisit: "Revisit",
  other: "Other",
};

/**
 * Today as a plain calendar date in THIS phone's timezone — what the crew
 * would write on a sheet. `toISOString().slice(0,10)` is UTC, which rolls
 * over at 8pm in Toronto: a trip logged after supper would be dated tomorrow.
 */
export function todayLocalDate(now: Date = new Date()): string {
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

/** "Tue, Sep 8" — a date the way someone reads it off a calendar, not ISO. */
export function formatTripDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  // Construct in local time: `new Date("2026-09-08")` parses as UTC and shows
  // the day before in Toronto.
  return new Date(y, m - 1, d).toLocaleDateString("en-CA", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

/**
 * The site-trip log: every visit to this project, and which of them the
 * customer pays for.
 *
 * Trips belong to the project rather than a floor because a trip is a van
 * arriving at a building — one visit routinely covers several batches. (The
 * per-floor count this replaces was never filled in on a single floor of any
 * job.) Logging is manual with today prefilled: nothing is recorded that
 * nobody chose to record, which is what makes the count defensible on an
 * invoice.
 */
export function TripLog({
  projectId,
  onChange,
}: {
  projectId: string;
  /** Called after any change, so the Money card beside this one re-reads. */
  onChange?: () => void;
}) {
  const [trips, setTrips] = useState<Trip[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [date, setDate] = useState(() => todayLocalDate());
  const [purpose, setPurpose] = useState<TripPurpose>("install");
  const [billable, setBillable] = useState(true);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => setTrips(await listTrips(projectId)), [projectId]);

  useEffect(() => {
    let cancelled = false;
    void listTrips(projectId).then((rows) => {
      if (!cancelled) setTrips(rows);
    });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  function openAdd() {
    setDate(todayLocalDate());
    setPurpose("install");
    setBillable(true);
    setNote("");
    setAdding(true);
  }

  async function handleAdd() {
    if (busy || !date) return;
    setBusy(true);
    try {
      await createTrip({ project_id: projectId, date, purpose, billable, note: note.trim() });
      setAdding(false);
      await refresh();
      triggerSyncIfAvailable();
      onChange?.();
    } finally {
      setBusy(false);
    }
  }

  async function handleToggleBillable(trip: Trip) {
    await updateTrip(trip.id, { billable: !trip.billable });
    await refresh();
    triggerSyncIfAvailable();
    onChange?.();
  }

  async function handleDelete(trip: Trip) {
    if (!window.confirm(`Remove the ${formatTripDate(trip.date)} trip?`)) return;
    await deleteTrip(trip.id);
    await refresh();
    triggerSyncIfAvailable();
    onChange?.();
  }

  if (trips === null) return null;

  const billableCount = trips.filter((t) => t.billable).length;

  return (
    <section>
      <div className="mb-2 flex items-baseline justify-between">
        <h2 className="text-sm font-semibold text-neutral-500">Site trips</h2>
        <span className="text-xs text-neutral-500">
          {trips.length === 0
            ? "none logged"
            : `${billableCount} billable${
                trips.length > billableCount ? ` · ${trips.length - billableCount} no charge` : ""
              }`}
        </span>
      </div>

      <div className="flex flex-col gap-2">
        {trips.map((trip) => (
          <div
            key={trip.id}
            className="flex items-center gap-2 rounded-lg border border-neutral-200 p-3 dark:border-neutral-800"
          >
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium">
                {formatTripDate(trip.date)}
                <span className="ml-2 font-normal text-neutral-500">
                  {TRIP_PURPOSE_LABEL[trip.purpose]}
                </span>
              </div>
              {trip.note && (
                <div className="mt-0.5 text-xs break-words text-neutral-500">{trip.note}</div>
              )}
            </div>
            {/* The billable state is the one thing worth changing after the
                fact — whose fault a revisit was often isn't known on the day. */}
            <button
              type="button"
              onClick={() => void handleToggleBillable(trip)}
              aria-pressed={trip.billable}
              className={`min-h-9 shrink-0 rounded-lg px-2.5 text-xs font-medium ${
                trip.billable
                  ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200"
                  : "bg-neutral-100 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400"
              }`}
            >
              {trip.billable ? "Billed" : "No charge"}
            </button>
            <button
              type="button"
              onClick={() => void handleDelete(trip)}
              aria-label={`Remove the ${formatTripDate(trip.date)} trip`}
              className="flex min-h-9 min-w-9 shrink-0 items-center justify-center rounded-lg text-neutral-400"
            >
              <Icon name="trash" size={16} />
            </button>
          </div>
        ))}
      </div>

      {adding ? (
        <div className="mt-2 flex flex-col gap-3 rounded-xl border border-neutral-200 p-4 dark:border-neutral-800">
          <label>
            <span className="mb-1 block text-sm text-neutral-500">Date</span>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="min-h-11 w-full rounded-lg border border-neutral-300 px-3 text-sm dark:border-neutral-700 dark:bg-neutral-900"
            />
          </label>

          <div>
            <div className="mb-1 text-sm text-neutral-500">What for</div>
            <div className="flex flex-wrap gap-1.5">
              {PURPOSES.map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setPurpose(value)}
                  aria-pressed={purpose === value}
                  className={`min-h-9 rounded-full border px-3 text-xs font-medium ${
                    purpose === value
                      ? "border-blue-600 bg-blue-600 text-white"
                      : "border-neutral-300 bg-white text-neutral-600 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <label className="flex min-h-11 items-center gap-3">
            <input
              type="checkbox"
              checked={billable}
              onChange={(e) => setBillable(e.target.checked)}
              className="h-5 w-5"
            />
            <span className="text-sm">
              Bill this trip{" "}
              <span className="text-neutral-500">(off for a return on our own error)</span>
            </span>
          </label>

          <label>
            <span className="mb-1 block text-sm text-neutral-500">Note (optional)</span>
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. Levels 3 and 4, recut for 306"
              className="min-h-11 w-full rounded-lg border border-neutral-300 px-3 text-sm dark:border-neutral-700 dark:bg-neutral-900"
            />
          </label>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void handleAdd()}
              disabled={busy || !date}
              className="min-h-11 flex-1 rounded-lg bg-blue-600 text-sm font-semibold text-white disabled:opacity-50"
            >
              {busy ? "Adding…" : "Add trip"}
            </button>
            <button
              type="button"
              onClick={() => setAdding(false)}
              className="min-h-11 rounded-lg bg-neutral-100 px-4 text-sm dark:bg-neutral-800"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={openAdd}
          className="mt-2 min-h-11 w-full rounded-lg bg-neutral-100 text-sm font-medium dark:bg-neutral-800"
        >
          + Log a trip
        </button>
      )}
    </section>
  );
}
