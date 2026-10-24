"use client";

import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import {
  fetchPmProject,
  flagPmDeficiency,
  pmDate,
  pmProgress,
  pmTime,
  pmUnitKind,
  pmUnitRange,
  pmWindowLabels,
  type PmBlindLabel,
  type PmDeficiency,
  type PmProject,
  type PmUnit,
  type PmUnitKind,
} from "@/lib/pm";
import { Icon } from "@/components/icon";

/**
 * What an external project manager sees (see
 * docs/superpowers/specs/2026-09-06-pm-view-design.md): which units are
 * complete, why the rest are not, and a place to say what's wrong. No
 * sign-in, no local database, no sizes, no crew notes, no money — the server
 * function only returns this much, and the reason for a revisit is only ever
 * "your report" or "the installer is coming back", never the crew's.
 */
export default function PmPage() {
  const { token } = useParams<{ token: string }>();
  const [data, setData] = useState<PmProject | null | undefined>(undefined);
  const [loadedAt, setLoadedAt] = useState<Date | null>(null);
  // The last fetch failed. Over a loaded page it is only a note: a dropped
  // refresh on a site with one bar of signal used to replace the whole page
  // with "Couldn't reach the server" (PM review, 2026-10-24).
  const [failed, setFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [slow, setSlow] = useState(false);
  // Remembered so a link revoked mid-visit can still say who to ask.
  const [company, setCompany] = useState<string | null>(null);
  const [openUnitId, setOpenUnitId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [flashId, setFlashId] = useState<string | null>(null);
  // Only the newest fetch may land: a slow one that started before a report
  // was sent would otherwise put the page back without it.
  const seq = useRef(0);
  const slowTimer = useRef<number | undefined>(undefined);

  /** Starts a fetch; its result lands only if no newer one has started since. */
  const fetchNow = useCallback((): Promise<void> => {
    const mine = ++seq.current;
    return fetchPmProject(token).then(
      (d) => {
        if (mine !== seq.current) return;
        setData(d);
        setFailed(false);
        if (d) {
          setLoadedAt(new Date());
          if (d.company) setCompany(d.company);
        }
      },
      () => {
        if (mine === seq.current) setFailed(true);
      }
    );
  }, [token]);

  useEffect(() => {
    const timer = window.setTimeout(() => setSlow(true), 5000);
    slowTimer.current = timer;
    void fetchNow();
    // A PM checks in, pockets the phone, and opens it again an hour later
    // from the lock screen: the page should be today's, not the morning's.
    const onVisible = () => {
      if (document.visibilityState === "visible") void fetchNow();
    };
    document.addEventListener("visibilitychange", onVisible);
    const requests = seq;
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
      requests.current++;
    };
  }, [fetchNow]);

  function retry() {
    setFailed(false);
    setSlow(false);
    window.clearTimeout(slowTimer.current);
    slowTimer.current = window.setTimeout(() => setSlow(true), 5000);
    void fetchNow();
  }

  async function refresh() {
    setRefreshing(true);
    await fetchNow();
    setRefreshing(false);
  }

  /** A report the server accepted shows at once, whether or not the refetch gets through. */
  function addSent(unitId: string, row: PmDeficiency) {
    setData((prev) =>
      prev
        ? {
            ...prev,
            floors: prev.floors.map((f) => ({
              ...f,
              units: f.units.map((u) =>
                u.id === unitId
                  ? // Installed with an open deficiency is blocked on the
                    // server too (013), so the tile turns as it will on reload.
                    { ...u, blocked: u.blocked || u.done, deficiencies: [...u.deficiencies, row] }
                  : u
              ),
            })),
          }
        : prev
    );
    void fetchNow();
  }

  if (data === undefined && failed) {
    return (
      <main className="mx-auto flex w-full max-w-md flex-col gap-3 p-6">
        <h1 className="text-lg font-semibold">Couldn&apos;t load the install progress</h1>
        <p className="text-sm text-neutral-500">
          The connection dropped or the server didn&apos;t answer. Check your signal and try again.
        </p>
        <button
          type="button"
          onClick={retry}
          className="min-h-11 w-full rounded-lg bg-blue-600 text-sm font-semibold text-white active:bg-blue-700"
        >
          Try again
        </button>
      </main>
    );
  }
  if (data === undefined) return <LoadingSkeleton slow={slow} />;
  if (data === null) {
    return (
      <main className="mx-auto w-full max-w-md p-6">
        <h1 className="text-lg font-semibold">This link isn&apos;t active</h1>
        <p className="mt-2 text-sm text-neutral-500">Ask {company || "your installer"} for a new one.</p>
      </main>
    );
  }

  const project = data;
  const allUnits = project.floors.flatMap((f) => f.units);
  const total = pmProgress(allUnits);
  const firstFixing = allUnits.find((u) => u.blocked && !u.locked);
  const firstLocked = allUnits.find((u) => u.locked);

  // Locked first: those are the only ones where the PM has something to do.
  const attention: { key: string; unit: PmUnit; d?: PmDeficiency; labels?: Map<string, PmBlindLabel> }[] = [
    ...allUnits.filter((u) => u.locked).map((u) => ({ key: `l-${u.id}`, unit: u })),
    ...allUnits.flatMap((u) => {
      const labels = pmWindowLabels(u);
      return u.deficiencies
        .filter((d) => d.status === "open")
        .map((d) => ({ key: d.id, unit: u, d, labels }));
    }),
  ];

  function jumpToUnit(unitId: string, open: boolean) {
    const floor = project.floors.find((f) => f.units.some((u) => u.id === unitId));
    if (floor) setExpanded((s) => (s.has(floor.id) ? s : new Set(s).add(floor.id)));
    if (open) setOpenUnitId(unitId);
    setFlashId(unitId);
    // After the panel's own "nearest" scroll, so this one wins: the tile at
    // the top, its panel under it.
    window.setTimeout(() => {
      document
        .getElementById(`pm-unit-${unitId}`)
        ?.scrollIntoView({ block: open ? "start" : "center", behavior: "smooth" });
    }, 80);
    window.setTimeout(() => setFlashId((id) => (id === unitId ? null : id)), 1800);
  }

  function toggleFloor(id: string) {
    setExpanded((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const loadedLabel = loadedAt ? pmTime(loadedAt) : "";

  // w-full matters: mx-auto on a flex child drops it to shrink-to-fit, and the
  // page was rendering 293px wide on a 390px phone, tiles squeezed to 82px.
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-5 p-4 pb-12">
      <header>
        <div className="text-sm text-neutral-500">
          {project.company ? `${project.company} · install progress` : "Install progress"}
        </div>
        <h1 className="text-xl font-semibold">{project.project.name}</h1>
        {project.project.address && <div className="text-sm text-neutral-500">{project.project.address}</div>}
        <div className="mt-3 text-base">
          <b>{total.complete}</b> of <b>{total.total}</b> units complete
        </div>
        <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800">
          <div
            className="h-full bg-emerald-500"
            style={{ width: total.total ? `${(100 * total.complete) / total.total}%` : "0%" }}
          />
        </div>
        {(firstFixing || firstLocked) && (
          <div className="mt-3 flex flex-wrap gap-2">
            {firstFixing && (
              <button
                type="button"
                onClick={() => jumpToUnit(firstFixing.id, false)}
                className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-amber-400 bg-amber-100 px-4 text-sm font-medium text-amber-900 dark:border-amber-600 dark:bg-amber-900/40 dark:text-amber-200"
              >
                <Icon name="alert" size={14} /> {total.fixing} being fixed
              </button>
            )}
            {firstLocked && (
              <button
                type="button"
                onClick={() => jumpToUnit(firstLocked.id, false)}
                className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-violet-400 bg-violet-100 px-4 text-sm font-medium text-violet-900 dark:border-violet-600 dark:bg-violet-900/40 dark:text-violet-200"
              >
                <Icon name="lock" size={14} /> {total.noAccess} no access
              </button>
            )}
          </div>
        )}
        {failed ? (
          <div
            role="status"
            className="mt-3 flex items-center gap-2 rounded-lg bg-neutral-100 py-1 pl-3 text-sm text-neutral-700 dark:bg-neutral-800 dark:text-neutral-200"
          >
            <span className="flex-1">Couldn&apos;t refresh — showing what loaded at {loadedLabel}.</span>
            <button
              type="button"
              onClick={() => void refresh()}
              disabled={refreshing}
              className="min-h-11 shrink-0 px-3 font-semibold text-blue-700 disabled:opacity-50 dark:text-blue-300"
            >
              {refreshing ? "Refreshing…" : "Refresh"}
            </button>
          </div>
        ) : (
          <div className="mt-1 flex items-center text-xs text-neutral-500">
            <span>Updated {loadedLabel} ·</span>
            <button
              type="button"
              onClick={() => void refresh()}
              disabled={refreshing}
              className="inline-flex min-h-11 items-center px-2 font-semibold text-blue-700 disabled:opacity-50 dark:text-blue-300"
            >
              {refreshing ? "Refreshing…" : "Refresh"}
            </button>
          </div>
        )}
      </header>

      {attention.length > 0 && (
        <section className="rounded-xl border border-neutral-200 p-3 dark:border-neutral-800">
          <h2 className="mb-1 text-sm font-semibold">Needs your attention</h2>
          <ul className="flex flex-col divide-y divide-neutral-100 dark:divide-neutral-800">
            {attention.map(({ key, unit, d, labels }) => (
              <li key={key}>
                <button
                  type="button"
                  onClick={() => jumpToUnit(unit.id, true)}
                  className="flex min-h-11 w-full items-start gap-2 py-2 text-left text-sm"
                >
                  {d ? (
                    <>
                      <span className="mt-0.5 text-amber-600 dark:text-amber-400">
                        <Icon name="alert" size={16} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate">
                          <b>{unit.number}</b> · {blindName(d, labels)} — {d.note}
                        </span>
                        <span className="block text-xs text-neutral-500">
                          Reported {pmDate(d.raised_at)} · with the installer
                        </span>
                      </span>
                    </>
                  ) : (
                    <>
                      <span className="mt-0.5 text-violet-700 dark:text-violet-300">
                        <Icon name="lock" size={16} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <b>{unit.number}</b> — we couldn&apos;t get in, please arrange access
                      </span>
                    </>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {project.floors.map((floor) => {
        const p = pmProgress(floor.units);
        const range = pmUnitRange(floor.units);
        const allComplete = p.total > 0 && p.complete === p.total;
        // A finished floor is 24 identical green tiles between the PM and the
        // units still in progress. One line says the same thing.
        if (allComplete && !expanded.has(floor.id)) {
          return (
            <section key={floor.id}>
              <button
                type="button"
                onClick={() => toggleFloor(floor.id)}
                className="flex min-h-11 w-full items-center gap-2 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-left text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200"
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold">
                    {floor.label} — all {p.total} complete ✓
                  </span>
                  {range && <span className="block text-xs opacity-80">{range}</span>}
                </span>
                <span className="shrink-0 text-xs font-medium">Show</span>
              </button>
            </section>
          );
        }
        return (
          <section key={floor.id}>
            <div className="mb-1.5 flex items-end justify-between gap-2">
              <div className="min-w-0">
                <h2 className="text-sm font-semibold">{floor.label}</h2>
                {range && <div className="text-xs text-neutral-500">{range}</div>}
              </div>
              <div className="flex shrink-0 items-center text-xs text-neutral-500">
                <span>
                  {p.complete}/{p.total} complete
                </span>
                {allComplete && (
                  <button
                    type="button"
                    onClick={() => toggleFloor(floor.id)}
                    className="ml-1 inline-flex min-h-11 items-center px-2 font-medium text-blue-700 dark:text-blue-300"
                  >
                    Hide
                  </button>
                )}
              </div>
            </div>
            <div className="mb-2 h-1.5 w-full overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800">
              <div
                className="h-full bg-emerald-500"
                style={{ width: p.total ? `${(100 * p.complete) / p.total}%` : "0%" }}
              />
            </div>
            {/* The open unit's panel is a full-width row placed straight after
                the tile that was tapped. It used to render once, after every
                floor, at the foot of the page — on a building with six floors
                that is a screen or two below the tap, and the only visible
                response was a thin ring on the tile: "nothing happens" (PM
                report, 2026-09-09). Dense flow keeps the tapped row intact
                (the tiles after it backfill its remaining cells) so the panel
                lands directly under that row, accordion-style. It stays in the
                page rather than in a fixed sheet: a note field in a fixed
                overlay is what sends iOS scrolling to the end of the page while
                typing (components/keyboard.tsx). */}
            <div className="grid grid-flow-row-dense grid-cols-3 gap-2 sm:grid-cols-4">
              {floor.units.map((u) => {
                const kind = pmUnitKind(u);
                const open = u.deficiencies.filter((d) => d.status === "open").length;
                return (
                  <Fragment key={u.id}>
                    <button
                      type="button"
                      id={`pm-unit-${u.id}`}
                      aria-expanded={u.id === openUnitId}
                      onClick={() => setOpenUnitId(u.id === openUnitId ? null : u.id)}
                      className={`relative flex min-h-16 scroll-mt-4 flex-col items-center justify-center rounded-lg border px-2 py-2 text-center transition-shadow ${TILE_CLASS[kind]} ${
                        u.id === openUnitId || u.id === flashId ? "ring-2 ring-blue-500" : ""
                      }`}
                    >
                      <span className="w-full truncate text-sm font-semibold">{u.number}</span>
                      <span className="inline-flex items-center gap-1 text-xs opacity-90">
                        <TileIcon kind={kind} /> {TILE_TEXT[kind]}
                      </span>
                      {open > 0 && (
                        <span className="absolute -right-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-amber-500 px-1 text-[10px] font-semibold text-white">
                          {open}
                        </span>
                      )}
                    </button>
                    {u.id === openUnitId && (
                      <div className="col-span-full">
                        <UnitPanel
                          key={u.id}
                          token={token}
                          unit={u}
                          onSent={(row) => addSent(u.id, row)}
                          onClose={() => setOpenUnitId(null)}
                        />
                      </div>
                    )}
                  </Fragment>
                );
              })}
            </div>
          </section>
        );
      })}

      <footer className="mt-4 text-center text-xs text-neutral-500">
        Shared with {project.label || "you"}
        {project.company ? ` by ${project.company}` : ""}
      </footer>
    </main>
  );
}

const TILE_CLASS: Record<PmUnitKind, string> = {
  locked:
    "border-violet-400 bg-violet-100 text-violet-900 dark:border-violet-600 dark:bg-violet-900/40 dark:text-violet-200",
  yourReport:
    "border-amber-400 bg-amber-100 text-amber-900 dark:border-amber-600 dark:bg-amber-900/40 dark:text-amber-200",
  returnVisit:
    "border-amber-400 bg-amber-100 text-amber-900 dark:border-amber-600 dark:bg-amber-900/40 dark:text-amber-200",
  complete:
    "border-emerald-400 bg-emerald-100 text-emerald-900 dark:border-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-200",
  notYet:
    "border-neutral-300 bg-neutral-50 text-neutral-600 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300",
};

/** A revisit says whose it is — "revisit" alone sent PMs hunting for a report they never made. */
const TILE_TEXT: Record<PmUnitKind, string> = {
  locked: "no access",
  yourReport: "your report",
  returnVisit: "return visit",
  complete: "complete",
  notYet: "not yet",
};

function TileIcon({ kind }: { kind: PmUnitKind }) {
  if (kind === "locked") return <Icon name="lock" size={12} />;
  if (kind === "yourReport" || kind === "returnVisit") return <Icon name="alert" size={12} />;
  if (kind === "complete") return <Icon name="check" size={12} />;
  return null;
}

function blindName(d: Pick<PmDeficiency, "window_id">, labels?: Map<string, PmBlindLabel>): string {
  if (!d.window_id) return "Whole unit";
  return labels?.get(d.window_id)?.name ?? "A blind";
}

function LoadingSkeleton({ slow }: { slow: boolean }) {
  return (
    <main aria-busy="true" className="mx-auto flex w-full max-w-md flex-1 flex-col gap-5 p-4 pb-12">
      <div className="flex animate-pulse flex-col gap-2">
        <div className="h-4 w-32 rounded bg-neutral-200 dark:bg-neutral-800" />
        <div className="h-6 w-56 rounded bg-neutral-200 dark:bg-neutral-800" />
        <div className="h-4 w-40 rounded bg-neutral-200 dark:bg-neutral-800" />
        <div className="mt-2 h-2 w-full rounded-full bg-neutral-200 dark:bg-neutral-800" />
      </div>
      <p role="status" className={`text-sm ${slow ? "font-medium text-neutral-700 dark:text-neutral-200" : "sr-only"}`}>
        {slow ? "Still loading — signal may be weak" : "Loading install progress"}
      </p>
      <div className="grid animate-pulse grid-cols-3 gap-2">
        {Array.from({ length: 9 }, (_, i) => (
          <div key={i} className="h-16 rounded-lg bg-neutral-100 dark:bg-neutral-900" />
        ))}
      </div>
    </main>
  );
}

type SendState = "idle" | "sending" | "sent" | "failed" | "refused";

/**
 * In the page, not a fixed sheet: the note field must not sit inside a fixed
 * overlay on iOS (components/keyboard.tsx).
 */
function UnitPanel({
  token,
  unit,
  onSent,
  onClose,
}: {
  token: string;
  unit: PmUnit;
  onSent: (row: PmDeficiency) => void;
  onClose: () => void;
}) {
  const kind = pmUnitKind(unit);
  // Where there is nothing installed to report on, or the PM's job is to get
  // the door open, the report form is a step away rather than the first
  // thing in the panel — but still there, to say "it's open now".
  const folded = kind === "locked" || kind === "notYet";
  const [formOpen, setFormOpen] = useState(!folded);
  const [windowId, setWindowId] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [state, setState] = useState<SendState>("idle");
  const labels = pmWindowLabels(unit);
  const panelRef = useRef<HTMLElement>(null);

  // The panel opens below the tapped row, which near the bottom of the screen
  // means below the fold. Bring it up just far enough to be seen — "nearest"
  // leaves the page alone when it is already in view, so a tap high on the
  // screen does not lurch. Keyed by unit, so switching units runs this again.
  useEffect(() => {
    panelRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, []);

  async function submit() {
    const body = note.trim();
    if (!body || state === "sending") return;
    setState("sending");
    try {
      const id = await flagPmDeficiency(token, unit.id, windowId, body);
      if (!id) {
        setState("refused");
        return;
      }
      onSent({ id, window_id: windowId, note: body, status: "open", raised_at: new Date().toISOString() });
      setNote("");
      setWindowId(null);
      setState("sent");
    } catch {
      setState("failed");
    }
  }

  return (
    <section
      ref={panelRef}
      className="rounded-xl border border-blue-300 bg-blue-50/40 p-4 dark:border-blue-800 dark:bg-blue-950/20"
    >
      <div className="mb-2 flex items-start justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold">Unit {unit.number}</h2>
          <div className={`inline-flex items-center gap-1 text-xs font-medium ${STATUS_CLASS[kind]}`}>
            <TileIcon kind={kind} /> {STATUS_TEXT[kind]}
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="-mr-2 -mt-2 flex min-h-11 min-w-11 items-center justify-center rounded-lg text-neutral-500 active:bg-neutral-100 dark:active:bg-neutral-800"
        >
          <Icon name="close" size={20} />
        </button>
      </div>

      {REASON[kind] && <p className="mb-3 text-sm">{REASON[kind]}</p>}

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
              <div>
                <span className="font-medium">{blindName(d, labels)}</span>
                {d.window_id && labels.get(d.window_id)?.code && (
                  <span className="ml-1 text-xs opacity-70">{labels.get(d.window_id)?.code}</span>
                )}{" "}
                — {d.note}
              </div>
              <div className="mt-0.5 text-xs font-medium opacity-80">
                {d.status === "resolved"
                  ? d.resolved_at
                    ? `✓ Fixed ${pmDate(d.resolved_at)}`
                    : "✓ Fixed"
                  : `Reported ${pmDate(d.raised_at)} · with the installer`}
              </div>
            </li>
          ))}
        </ul>
      )}

      {state === "sent" && (
        <div
          role="status"
          className="mb-3 rounded-lg bg-emerald-100 px-3 py-2 text-sm font-medium text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-200"
        >
          ✓ Sent to the installer. It&apos;s listed above.
        </div>
      )}

      {!formOpen ? (
        <button
          type="button"
          onClick={() => setFormOpen(true)}
          className="min-h-11 w-full rounded-lg border border-neutral-300 bg-white text-sm font-medium dark:border-neutral-700 dark:bg-neutral-900"
        >
          Leave a note for the installer
        </button>
      ) : (
        <>
          <h3 className="text-sm font-semibold">{folded ? "Leave a note for the installer" : "Report a deficiency"}</h3>
          {unit.windows.length > 0 && (
            <>
              <p className="mb-2 text-xs text-neutral-500">
                Pick the blind if you know it — or leave &lsquo;Whole unit&rsquo; and say where.
              </p>
              <div className="mb-2 flex flex-wrap gap-1.5">
                <BlindChip selected={windowId === null} onClick={() => setWindowId(null)} name="Whole unit" code="" />
                {unit.windows.map((w) => {
                  const l = labels.get(w.id);
                  return (
                    <BlindChip
                      key={w.id}
                      selected={windowId === w.id}
                      onClick={() => setWindowId(w.id)}
                      name={l?.name ?? ""}
                      code={l?.code ?? ""}
                    />
                  );
                })}
              </div>
            </>
          )}
          <textarea
            value={note}
            onChange={(e) => {
              setNote(e.target.value);
              if (state !== "sending") setState("idle");
            }}
            rows={3}
            maxLength={1000}
            aria-label="What's wrong"
            placeholder={
              kind === "locked"
                ? "e.g. the unit is open now, or the super has a key"
                : "e.g. bottom rail scratched, chain missing, blind hangs crooked"
            }
            className="mt-1 w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900"
          />
          {state === "failed" && (
            <div role="alert" className="mt-1 text-sm text-red-700 dark:text-red-400">
              Couldn&apos;t send that. Check your connection and try again.
            </div>
          )}
          {state === "refused" && (
            <div role="alert" className="mt-1 text-sm text-red-700 dark:text-red-400">
              This link is no longer active — ask the installer for a new one.
            </div>
          )}
          <button
            type="button"
            onClick={() => void submit()}
            disabled={!note.trim() || state === "sending"}
            className="mt-3 min-h-11 w-full rounded-lg bg-blue-600 text-sm font-semibold text-white active:bg-blue-700 disabled:opacity-50"
          >
            {state === "sending" ? "Sending…" : "Send"}
          </button>
        </>
      )}
    </section>
  );
}

function BlindChip({
  selected,
  onClick,
  name,
  code,
}: {
  selected: boolean;
  onClick: () => void;
  name: string;
  code: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={`inline-flex min-h-11 items-center gap-1 rounded-full border px-4 text-sm font-medium ${
        selected
          ? "border-blue-600 bg-blue-600 text-white"
          : "border-neutral-300 bg-white text-neutral-700 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300"
      }`}
    >
      {name}
      {code && <span className="text-xs opacity-70">{code}</span>}
    </button>
  );
}

const STATUS_CLASS: Record<PmUnitKind, string> = {
  locked: "text-violet-700 dark:text-violet-300",
  yourReport: "text-amber-700 dark:text-amber-300",
  returnVisit: "text-amber-700 dark:text-amber-300",
  complete: "text-emerald-700 dark:text-emerald-300",
  notYet: "text-neutral-500",
};

const STATUS_TEXT: Record<PmUnitKind, string> = {
  locked: "No access",
  yourReport: "Needs a revisit",
  returnVisit: "Needs a revisit",
  complete: "Complete",
  notYet: "Not installed yet",
};

/** Why — in the PM's terms only. The crew's own reason never reaches this page. */
const REASON: Record<PmUnitKind, string> = {
  locked: "We couldn't get in. Can you arrange access? Let the installer know when it's open.",
  yourReport: "Your report is with the installer.",
  returnVisit: "The installer is coming back to finish this unit. Nothing needed from you.",
  complete: "",
  notYet: "Nothing installed here yet.",
};
