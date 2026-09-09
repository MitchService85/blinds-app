"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import {
  fetchPmProject,
  flagPmDeficiency,
  pmProgress,
  pmWindowLabels,
  type PmProject,
  type PmUnit,
} from "@/lib/pm";
import { Icon } from "@/components/icon";

/**
 * What an external project manager sees (see
 * docs/superpowers/specs/2026-09-06-pm-view-design.md): which units are
 * done, and a place to say what's wrong. No sign-in, no local database, no
 * sizes, no notes, no money — the server function only returns this much.
 */
export default function PmPage() {
  const { token } = useParams<{ token: string }>();
  const [data, setData] = useState<PmProject | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [openUnitId, setOpenUnitId] = useState<string | null>(null);

  async function load() {
    try {
      setData(await fetchPmProject(token));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load");
    }
  }

  useEffect(() => {
    let cancelled = false;
    void fetchPmProject(token)
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Could not load");
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (error) {
    return <main className="p-6 text-sm text-neutral-500">Couldn&apos;t reach the server. Try again in a moment.</main>;
  }
  if (data === undefined) return <main className="p-6 text-sm text-neutral-500">Loading…</main>;
  if (data === null) {
    return (
      <main className="mx-auto max-w-md p-6">
        <h1 className="text-lg font-semibold">This link isn&apos;t active</h1>
        <p className="mt-2 text-sm text-neutral-500">
          It may have been revoked or mistyped. Ask the installer for a new one.
        </p>
      </main>
    );
  }

  const allUnits = data.floors.flatMap((f) => f.units);
  const total = pmProgress(allUnits);
  const openUnit = allUnits.find((u) => u.id === openUnitId) ?? null;

  return (
    <main className="mx-auto flex max-w-md flex-1 flex-col gap-5 p-4 pb-12">
      <header>
        <div className="text-xs uppercase tracking-wide text-neutral-500">Install progress</div>
        <h1 className="text-xl font-semibold">{data.project.name}</h1>
        {data.project.address && <div className="text-sm text-neutral-500">{data.project.address}</div>}
        <div className="mt-2 text-sm">
          <b>{total.done}</b> of <b>{total.total}</b> units done
          {allUnits.some((u) => u.locked) && (
            <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-violet-100 px-2 py-0.5 text-xs font-medium text-violet-900 dark:bg-violet-900/40 dark:text-violet-200">
              <Icon name="lock" size={12} /> {allUnits.filter((u) => u.locked).length} locked, access needed
            </span>
          )}
          {allUnits.some((u) => u.blocked && !u.locked) && (
            <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900 dark:bg-amber-900/40 dark:text-amber-200">
              <Icon name="alert" size={12} /> {allUnits.filter((u) => u.blocked && !u.locked).length} need a revisit
            </span>
          )}
        </div>
        <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800">
          <div
            className="h-full bg-emerald-500"
            style={{ width: total.total ? `${(100 * total.done) / total.total}%` : "0%" }}
          />
        </div>
      </header>

      {data.floors.map((floor) => {
        const p = pmProgress(floor.units);
        return (
          <section key={floor.id}>
            <div className="mb-2 flex items-baseline justify-between">
              <h2 className="text-sm font-semibold">{floor.label}</h2>
              <span className="text-xs text-neutral-500">
                {p.done}/{p.total} done
              </span>
            </div>
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
              {floor.units.map((u) => {
                const open = u.deficiencies.filter((d) => d.status === "open").length;
                return (
                  <button
                    key={u.id}
                    type="button"
                    onClick={() => setOpenUnitId(u.id === openUnitId ? null : u.id)}
                    className={`relative flex min-h-16 flex-col items-center justify-center rounded-lg border px-2 py-2 text-center ${
                      u.locked
                        ? "border-violet-400 bg-violet-100 text-violet-900 dark:border-violet-600 dark:bg-violet-900/40 dark:text-violet-200"
                        : u.blocked
                          ? "border-amber-400 bg-amber-100 text-amber-900 dark:border-amber-600 dark:bg-amber-900/40 dark:text-amber-200"
                          : u.done
                          ? "border-emerald-400 bg-emerald-100 text-emerald-900 dark:border-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-200"
                          : "border-neutral-300 bg-neutral-50 text-neutral-600 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300"
                    } ${u.id === openUnitId ? "ring-2 ring-blue-500" : ""}`}
                  >
                    <span className="w-full truncate text-sm font-semibold">{u.number}</span>
                    <span className="inline-flex items-center gap-1 text-[11px] opacity-80">
                      {u.locked ? (
                        <>
                          <Icon name="lock" size={12} /> locked
                        </>
                      ) : u.blocked ? (
                        <>
                          <Icon name="alert" size={12} /> revisit
                        </>
                      ) : u.done ? (
                        <>
                          <Icon name="check" size={12} /> done
                        </>
                      ) : (
                        "not yet"
                      )}
                    </span>
                    {open > 0 && (
                      <span className="absolute -right-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-amber-500 px-1 text-[10px] font-semibold text-white">
                        {open}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </section>
        );
      })}

      {openUnit && (
        <UnitPanel
          key={openUnit.id}
          token={token}
          unit={openUnit}
          onFlagged={() => void load()}
          onClose={() => setOpenUnitId(null)}
        />
      )}

      <footer className="mt-4 text-center text-[11px] text-neutral-500">
        Shared with {data.label || "you"} · Measure
      </footer>
    </main>
  );
}

/**
 * In the page, not a fixed sheet: the note field must not sit inside a fixed
 * overlay on iOS (components/keyboard.tsx).
 */
function UnitPanel({
  token,
  unit,
  onFlagged,
  onClose,
}: {
  token: string;
  unit: PmUnit;
  onFlagged: () => void;
  onClose: () => void;
}) {
  const [windowId, setWindowId] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [failed, setFailed] = useState(false);
  const labels = pmWindowLabels(unit);

  async function submit() {
    if (!note.trim() || busy) return;
    setBusy(true);
    setFailed(false);
    try {
      const id = await flagPmDeficiency(token, unit.id, windowId, note.trim());
      if (!id) {
        setFailed(true);
        return;
      }
      setNote("");
      setWindowId(null);
      setSent(true);
      onFlagged();
      window.setTimeout(() => setSent(false), 2500);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-xl border border-blue-300 bg-blue-50/40 p-4 dark:border-blue-800 dark:bg-blue-950/20">
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="text-base font-semibold">Unit {unit.number}</h2>
        <span
          className={`inline-flex items-center gap-1 text-xs font-medium ${
            unit.locked
              ? "text-violet-700 dark:text-violet-300"
              : unit.blocked
                ? "text-amber-700 dark:text-amber-300"
                : unit.done
                ? "text-emerald-700 dark:text-emerald-300"
                : "text-neutral-500"
          }`}
        >
          {unit.locked ? (
            <>
              <Icon name="lock" size={14} /> Locked — the crew couldn&apos;t get in
            </>
          ) : unit.blocked ? (
            <>
              <Icon name="alert" size={14} /> Needs a revisit
            </>
          ) : unit.done ? (
            <>
              <Icon name="check" size={14} /> Installed
            </>
          ) : (
            "Not installed yet"
          )}
        </span>
      </div>

      {unit.deficiencies.length > 0 && (
        <ul className="mb-4 flex flex-col gap-1.5">
          {unit.deficiencies.map((d) => (
            <li
              key={d.id}
              className={`rounded-lg px-3 py-2 text-sm ${
                d.status === "resolved"
                  ? "bg-emerald-50 text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200"
                  : "bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200"
              }`}
            >
              <span className="mr-1.5 text-xs font-semibold uppercase">
                {d.status === "resolved" ? "resolved" : "open"}
              </span>
              {d.window_id && <span className="mr-1 font-medium">{labels.get(d.window_id) ?? "blind"}:</span>}
              {d.note}
            </li>
          ))}
        </ul>
      )}

      <div className="mb-1 text-xs text-neutral-500">Report a deficiency</div>
      {unit.windows.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={() => setWindowId(null)}
            className={`min-h-9 rounded-full border px-3 text-xs font-medium ${
              windowId === null
                ? "border-blue-600 bg-blue-600 text-white"
                : "border-neutral-300 bg-white text-neutral-600 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300"
            }`}
          >
            Whole unit
          </button>
          {unit.windows.map((w) => (
            <button
              key={w.id}
              type="button"
              onClick={() => setWindowId(w.id)}
              className={`min-h-9 rounded-full border px-3 text-xs font-medium ${
                windowId === w.id
                  ? "border-blue-600 bg-blue-600 text-white"
                  : "border-neutral-300 bg-white text-neutral-600 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300"
              }`}
            >
              {labels.get(w.id)}
            </button>
          ))}
        </div>
      )}
      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        rows={3}
        maxLength={1000}
        placeholder="e.g. bottom rail scratched, chain missing, blind hangs crooked"
        className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900"
      />
      {failed && (
        <div className="mt-1 text-xs text-red-600">Couldn&apos;t send that. Check your connection and try again.</div>
      )}
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={onClose}
          className="min-h-11 flex-1 rounded-lg bg-neutral-100 text-sm font-medium dark:bg-neutral-800"
        >
          Close
        </button>
        <button
          type="button"
          onClick={() => void submit()}
          disabled={!note.trim() || busy}
          className={`min-h-11 flex-1 rounded-lg text-sm font-semibold text-white disabled:opacity-50 ${
            sent ? "bg-emerald-600" : "bg-blue-600"
          }`}
        >
          {busy ? "Sending…" : sent ? "✓ Sent" : "Send"}
        </button>
      </div>
    </section>
  );
}
