"use client";

// The interactive pieces of the tour (app/help/tour). Each is a small working
// copy of one screen, with sample data, that reports back when the learner
// has done the thing the step is teaching.
//
// Where the real component can be used it is — the keypad, the job card,
// the tile colours — so the tour cannot drift out of date the way the old
// written guide did (it was still promising an automatic width-to-height
// flip that the app no longer does). Where it can't, the markup copies the
// real screen's classes.

import { useState, type ReactNode } from "react";
import { Icon } from "@/components/icon";
import { Keypad, usePrecision } from "@/components/keypad";
import { JobCard, type FloorProgress } from "@/components/job-card";
import { UNIT_STATE_TILE_CLASSES, type DerivedUnitState } from "@/components/status";
import { formatFraction } from "@/lib/fractions";
import type { Project } from "@/lib/types";

export interface DemoProps {
  /** Called when the learner has done what the step teaches. */
  onDone: () => void;
}

/** What to try, then what happened — one line under every demo. */
function Prompt({ done, children }: { done: boolean; children: ReactNode }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={`mt-3 flex items-start gap-2 rounded-lg px-3 py-2.5 text-sm leading-snug ${
        done
          ? "bg-emerald-50 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200"
          : "bg-blue-50 text-blue-900 dark:bg-blue-950 dark:text-blue-200"
      }`}
    >
      <span aria-hidden className="mt-0.5 shrink-0">
        {done ? <Icon name="check" size={16} /> : "👉"}
      </span>
      <span>{children}</span>
    </div>
  );
}

const MORE_BUTTON =
  "absolute -right-2 -top-2 flex h-9 w-9 items-center justify-center rounded-full bg-neutral-900/70 text-white dark:bg-white/80 dark:text-neutral-900";
const TILE = "relative flex min-h-16 flex-col items-center justify-center rounded-lg border p-2 text-center";
const CHIP = "min-h-11 rounded-full border px-4 text-sm font-medium";
const CHIP_ON = "border-blue-600 bg-blue-600 text-white";
const CHIP_OFF =
  "border-neutral-300 bg-white text-neutral-700 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300";

// ---------------------------------------------------------------------------
// 1. Your jobs — the real job card, with taps caught instead of navigating
// ---------------------------------------------------------------------------

const SAMPLE_PROJECT: Project = {
  id: "guide-sample",
  updated_at: "2026-01-01T00:00:00.000Z",
  deleted: false,
  name: "Lakeside Towers",
  address: "100 Main St",
  building_type: "residential",
  tag_chips: ["LR", "BR", "MBR", "K"],
};

const SAMPLE_FLOORS: FloorProgress[] = [
  { id: "l4", label: "Level 4", done: 18, total: 24, blinds: 61, install: null },
  { id: "l5", label: "Level 5", done: 3, total: 24, blinds: 9, install: null },
];

export function JobsDemo({ onDone }: DemoProps) {
  const [expanded, setExpanded] = useState(false);
  const [tapped, setTapped] = useState<"job" | "floor" | null>(null);
  return (
    <>
      <div
        // The card's name and floor chips are real links. In the tour they
        // explain where they'd go instead of going there.
        onClickCapture={(e) => {
          const link = (e.target as HTMLElement).closest("a");
          if (!link) return;
          e.preventDefault();
          e.stopPropagation();
          const floor = link.getAttribute("href")?.includes("/floor/");
          setTapped(floor ? "floor" : "job");
          if (floor) onDone();
        }}
      >
        <JobCard
          project={SAMPLE_PROJECT}
          floors={SAMPLE_FLOORS}
          expanded={expanded}
          onToggle={() => setExpanded((v) => !v)}
        />
      </div>
      <Prompt done={tapped === "floor"}>
        {tapped === "floor"
          ? "That opens the floor: a grid of its units. That's where most of the day is spent."
          : tapped === "job"
            ? "Tapping the job's name opens its page — floors, plus the job's settings. Now tap ▾ and pick a floor."
            : expanded
              ? "Each chip is a floor: units done out of the total. Tap one."
              : "This is a job on your home screen. Tap ▾ to see its floors."}
      </Prompt>
    </>
  );
}

// ---------------------------------------------------------------------------
// 2. The unit grid — tap opens, ⋯ marks
// ---------------------------------------------------------------------------

interface GridUnit {
  number: string;
  rooms: string;
  blinds: number;
  state: DerivedUnitState;
}

const STATE_WORDS: Record<DerivedUnitState, string> = {
  not_started: "not started yet",
  in_progress: "started",
  done: "done",
  na: "skipped (N/A)",
};

export function GridDemo({ onDone }: DemoProps) {
  const [units, setUnits] = useState<GridUnit[]>([
    { number: "401", rooms: "LR BR", blinds: 4, state: "done" },
    { number: "402", rooms: "LR", blinds: 2, state: "in_progress" },
    { number: "403", rooms: "LR BR", blinds: 3, state: "in_progress" },
    { number: "404", rooms: "", blinds: 0, state: "not_started" },
  ]);
  const [menu, setMenu] = useState<string | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  const done = units.find((u) => u.number === "403")?.state === "done";

  function mark(number: string, state: DerivedUnitState) {
    setUnits((us) => us.map((u) => (u.number === number ? { ...u, state } : u)));
    setMenu(null);
    if (number === "403" && state === "done") onDone();
    else setSaid(`${number} is now ${STATE_WORDS[state]}.`);
  }

  return (
    <>
      <div className="grid grid-cols-3 gap-3 pt-2">
        {units.map((u) => (
          <div key={u.number} className="relative">
            <button
              type="button"
              onClick={() => setSaid(`Tapping ${u.number} opens it, to measure its windows.`)}
              className={`${TILE} w-full ${UNIT_STATE_TILE_CLASSES[u.state]}`}
            >
              <span className="text-base font-semibold">{u.number}</span>
              {u.rooms && <span className="text-[10px] font-semibold">{u.rooms}</span>}
              <span className="text-[11px]">{u.blinds ? `${u.blinds} blinds` : "—"}</span>
            </button>
            <button
              type="button"
              aria-label={`Unit ${u.number} actions`}
              onClick={() => setMenu(menu === u.number ? null : u.number)}
              className={MORE_BUTTON}
            >
              <Icon name="more" size={16} />
            </button>
            {menu === u.number && (
              <div className="absolute left-0 right-0 top-full z-10 mt-1 overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-lg dark:border-neutral-700 dark:bg-neutral-900">
                {u.state !== "done" && (
                  <button type="button" onClick={() => mark(u.number, "done")} className="block min-h-11 w-full px-3 text-left text-sm">
                    Mark done
                  </button>
                )}
                {u.state !== "na" && (
                  <button type="button" onClick={() => mark(u.number, "na")} className="block min-h-11 w-full px-3 text-left text-sm">
                    Mark N/A
                  </button>
                )}
                {(u.state === "done" || u.state === "na") && (
                  <button type="button" onClick={() => mark(u.number, "in_progress")} className="block min-h-11 w-full px-3 text-left text-sm">
                    Reopen
                  </button>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-neutral-600 dark:text-neutral-400">
        <span><span className="inline-block h-2.5 w-2.5 rounded-sm bg-emerald-400 align-middle" /> done</span>
        <span><span className="inline-block h-2.5 w-2.5 rounded-sm bg-amber-300 align-middle" /> started</span>
        <span><span className="inline-block h-2.5 w-2.5 rounded-sm border border-neutral-400 align-middle" /> not started</span>
        <span className="line-through">skipped</span>
      </div>
      <Prompt done={done}>
        {done
          ? "That's it — 403 is done. The small line under each number lists the rooms measured there, so a unit missing its bedroom stands out."
          : said ?? "Measured 403 and finished? Tap its ⋯ and mark it done."}
      </Prompt>
    </>
  );
}

// ---------------------------------------------------------------------------
// 3. Measure a window — the real keypad
// ---------------------------------------------------------------------------

const GOAL_WIDTH = 35 * 16 + 8; // 35 1/2
const GOAL_HEIGHT = 60 * 16;

export function MeasureDemo({ onDone }: DemoProps) {
  const [tag, setTag] = useState<string | null>(null);
  const [field, setField] = useState<"width" | "height">("width");
  const [width, setWidth] = useState(0);
  const [height, setHeight] = useState(0);
  const [precision, setPrecision] = usePrecision();
  const [reported, setReported] = useState(false);

  const okTag = tag === "BR";
  const okWidth = width === GOAL_WIDTH;
  const okHeight = height === GOAL_HEIGHT;
  const done = okTag && okWidth && okHeight;

  // Reported from the taps themselves: telling the tour during render would
  // update another component mid-render.
  function after(nextTag: string | null, nextWidth: number, nextHeight: number) {
    if (reported || nextTag !== "BR" || nextWidth !== GOAL_WIDTH || nextHeight !== GOAL_HEIGHT) return;
    setReported(true);
    onDone();
  }

  const show = (v: number) => (v ? formatFraction(v) : "—");
  const tick = (ok: boolean, label: string) => (
    <li className={`flex items-center gap-1.5 ${ok ? "text-emerald-700 dark:text-emerald-300" : ""}`}>
      <span aria-hidden className="w-4">{ok ? "✓" : "○"}</span>
      {label}
    </li>
  );

  return (
    <>
      {/* The goal goes first: under the keypad it sat below the fold on a
          phone, so you met the keypad before you knew what to type. */}
      <ul className="mb-3 flex flex-col gap-1 text-sm">
        {tick(okTag, "Pick the room: BR (bedroom)")}
        {tick(okWidth, "Width 35 ½ — tap 3, 5, then ½")}
        {tick(okHeight, "Tap Height, then 6, 0")}
      </ul>
      <div className="mb-3 flex flex-wrap gap-2">
        {["LR", "BR", "MBR", "K"].map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => {
              setTag(t);
              after(t, width, height);
            }}
            className={`${CHIP} ${tag === t ? CHIP_ON : CHIP_OFF}`}
          >
            {t}
          </button>
        ))}
      </div>
      <div className="mb-3 grid grid-cols-2 overflow-hidden rounded-lg border border-neutral-300 dark:border-neutral-700">
        {(["width", "height"] as const).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setField(f)}
            className={`min-h-11 text-sm font-medium capitalize ${f === field ? "bg-blue-600 text-white" : "bg-white text-neutral-700 dark:bg-neutral-900 dark:text-neutral-300"}`}
          >
            {f} {f === "width" ? show(width) : show(height)}
          </button>
        ))}
      </div>
      <Keypad
        key={field}
        valueSixteenths={field === "width" ? width : height}
        onChange={(v) => {
          if (field === "width") {
            setWidth(v);
            after(tag, v, height);
          } else {
            setHeight(v);
            after(tag, width, v);
          }
        }}
        precision={precision}
        onPrecisionChange={setPrecision}
      />
      <Prompt done={done}>
        {done
          ? "BR · 35 ½ × 60 — saved the moment you tapped it. In the app, Save · next window just moves you on to the next one."
          : "Enter a bedroom window, 35 ½ wide by 60 high. The fraction row is underneath the numbers."}
      </Prompt>
    </>
  );
}

// ---------------------------------------------------------------------------
// 4. Bay windows — + panel
// ---------------------------------------------------------------------------

export function BayDemo({ onDone }: DemoProps) {
  const [panels, setPanels] = useState(1);
  const done = panels === 3;
  return (
    <>
      <div className="flex items-end gap-1 rounded-lg border-2 border-neutral-400 p-2 dark:border-neutral-600" aria-label={`A window with ${panels} panels`}>
        {Array.from({ length: panels }, (_, i) => {
          const edge = panels > 1 && (i === 0 ? "Dl" : i === panels - 1 ? "Dr" : null);
          return (
            <div key={i} className="flex h-20 flex-1 flex-col items-center justify-between rounded bg-blue-100 py-1 text-xs text-blue-900 dark:bg-blue-900/50 dark:text-blue-100">
              <span className="font-semibold">Blind {i + 1}</span>
              {edge && <span className="rounded bg-white/80 px-1 text-[10px] font-semibold text-blue-800 dark:bg-blue-950 dark:text-blue-200">{edge}</span>}
            </div>
          );
        })}
      </div>
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={() => {
            const next = Math.min(3, panels + 1);
            setPanels(next);
            if (next === 3) onDone();
          }}
          className={`${CHIP} ${CHIP_OFF}`}
        >
          + panel
        </button>
        {panels > 1 && (
          <button type="button" onClick={() => setPanels((p) => p - 1)} className={`${CHIP} ${CHIP_OFF}`}>
            − panel
          </button>
        )}
      </div>
      <Prompt done={done}>
        {done
          ? "One window, three blinds. A deduct set to Both trims only the outer edges — Dl on the left blind, Dr on the right — never the middle."
          : "One frame holding three blinds side by side is ONE window. Tap + panel until it has three."}
      </Prompt>
    </>
  );
}

// ---------------------------------------------------------------------------
// 5. Orange warnings — the ⚠ explains itself; Looks right clears it
// ---------------------------------------------------------------------------

export function WarningDemo({ onDone }: DemoProps) {
  const [why, setWhy] = useState(false);
  const [checked, setChecked] = useState(false);
  return (
    <>
      <div className="relative w-28">
        <div className={`${TILE} ${UNIT_STATE_TILE_CLASSES.done}`}>
          <span className="text-base font-semibold">702</span>
          <span className="text-[10px] font-semibold">LR</span>
          <span className="text-[11px]">3 blinds</span>
        </div>
        {!checked && (
          <button
            type="button"
            aria-label="Why unit 702 is flagged"
            onClick={() => setWhy(true)}
            className="absolute -left-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-amber-500 text-white after:absolute after:-inset-2 after:content-['']"
          >
            <Icon name="alert" size={12} />
          </button>
        )}
      </div>

      {why && (
        <div className="mt-3 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">
          <div className="mb-1 font-semibold">Unit 702 — worth a second look</div>
          <div className="mb-3">
            <Icon name="alert" size={14} /> 702-LR1: all 3 blinds here are tagged LR — check the room tags, the last one carries over
          </div>
          {!checked ? (
            <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-white p-2 dark:border-amber-800 dark:bg-neutral-900">
              <div className="flex-1 text-xs">
                <div className="font-semibold text-neutral-800 dark:text-neutral-100">LR1 · 78 ⅞ × 87</div>
                Inside the unit, the warning sits on the blind it&apos;s about.
              </div>
              <button
                type="button"
                onClick={() => {
                  setChecked(true);
                  onDone();
                }}
                className="min-h-8 shrink-0 rounded-lg bg-amber-100 px-2.5 text-xs font-medium text-amber-900 dark:bg-amber-900 dark:text-amber-100"
              >
                Looks right
              </button>
            </div>
          ) : (
            <div className="text-xs">Checked, warnings off — and the ⚠ is gone from the tile.</div>
          )}
        </div>
      )}

      <Prompt done={checked}>
        {checked
          ? "A warning never blocks you. If it's wrong — 702 really is a one-room studio — Looks right clears it on every phone."
          : why
            ? "702 is a studio, so all-LR is right here. Tap Looks right."
            : "An orange ⚠ means something looks unusual. Tap it to see why."}
      </Prompt>
    </>
  );
}

// ---------------------------------------------------------------------------
// 6. Export — which file goes to the factory
// ---------------------------------------------------------------------------

export function ExportDemo({ onDone }: DemoProps) {
  const [picked, setPicked] = useState<"sheet" | "deficiency" | null>(null);
  return (
    <>
      <div className="flex flex-col gap-3">
        <section className="rounded-xl border border-neutral-200 p-3 dark:border-neutral-800">
          <h3 className="font-semibold">Factory measure sheet</h3>
          <p className="mb-2 mt-0.5 text-xs text-neutral-500">
            <b>This is the file the factory builds from.</b> Every window, in their format.
          </p>
          <button
            type="button"
            onClick={() => {
              setPicked("sheet");
              onDone();
            }}
            className="min-h-12 w-full rounded-xl bg-blue-600 text-sm font-semibold text-white"
          >
            Export measure sheet (.xlsx)
          </button>
        </section>
        <section className="rounded-xl border border-neutral-200 p-3 dark:border-neutral-800">
          <h3 className="font-semibold">Deficiency list</h3>
          <p className="mb-2 mt-0.5 text-xs text-neutral-500">
            <b>Flagged blinds only</b> — not a measure sheet.
          </p>
          <button
            type="button"
            onClick={() => setPicked("deficiency")}
            className="min-h-12 w-full rounded-xl border border-neutral-300 text-sm font-semibold text-neutral-700 dark:border-neutral-700 dark:text-neutral-200"
          >
            Export deficiency list — 12 rows (.xlsx)
          </button>
        </section>
      </div>
      <Prompt done={picked === "sheet"}>
        {picked === "sheet"
          ? "That's the one. Your phone's share sheet sends it — email, Drive, AirDrop. It works with no signal: the file is made on the phone."
          : picked === "deficiency"
            ? "Not for the factory — that's the punch list for the PM, and it only lists blinds with a problem, so tag numbers skip. The factory needs the blue one."
            : "A floor is measured. Which file does the factory need?"}
      </Prompt>
    </>
  );
}

// ---------------------------------------------------------------------------
// 7. Install day — the Measure / Install switch
// ---------------------------------------------------------------------------

type InstallMark = "staged" | "installed" | "locked" | "blocked" | null;

const MARK_LABEL: Record<Exclude<InstallMark, null>, { text: string; icon: "circle-dot" | "check-circle" | "lock" | "alert"; tone: string }> = {
  staged: { text: "Staged", icon: "circle-dot", tone: "text-emerald-600" },
  installed: { text: "Installed", icon: "check-circle", tone: "text-emerald-600" },
  locked: { text: "Locked out", icon: "lock", tone: "text-violet-600" },
  blocked: { text: "Blocked", icon: "alert", tone: "text-amber-600" },
};

export function InstallDemo({ onDone }: DemoProps) {
  const [mode, setMode] = useState<"measure" | "install">("measure");
  const [marks, setMarks] = useState<Record<string, InstallMark>>({ "501": null, "502": null, "503": null });
  const [sheet, setSheet] = useState<string | null>(null);
  const [nudge, setNudge] = useState(false);
  const done = Object.values(marks).includes("installed");

  return (
    <>
      <div className="mb-3 flex justify-end">
        <div className="flex overflow-hidden rounded-lg border border-neutral-300 dark:border-neutral-700">
          {(["measure", "install"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              aria-pressed={mode === m}
              className={`min-h-11 px-3.5 text-sm font-medium capitalize ${mode === m ? "bg-blue-600 text-white" : "bg-white text-neutral-600 dark:bg-neutral-900 dark:text-neutral-300"}`}
            >
              {m}
            </button>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-3 gap-3">
        {Object.entries(marks).map(([number, mark]) => (
          <button
            key={number}
            type="button"
            onClick={() => (mode === "install" ? setSheet(number) : setNudge(true))}
            className={`${TILE} ${UNIT_STATE_TILE_CLASSES.done}`}
          >
            <span className="text-base font-semibold">{number}</span>
            {mark ? (
              <span className={`flex items-center gap-1 text-[11px] font-semibold ${MARK_LABEL[mark].tone}`}>
                <Icon name={MARK_LABEL[mark].icon} size={12} /> {MARK_LABEL[mark].text}
              </span>
            ) : (
              <span className="text-[11px]">3 blinds</span>
            )}
          </button>
        ))}
      </div>
      {sheet && (
        <div className="mt-3 rounded-xl border border-neutral-200 p-2 dark:border-neutral-700">
          <div className="mb-1 px-1 text-sm font-semibold">Unit {sheet}</div>
          <div className="grid grid-cols-2 gap-2">
            {(Object.keys(MARK_LABEL) as Exclude<InstallMark, null>[]).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => {
                  setMarks((ms) => ({ ...ms, [sheet]: m }));
                  setSheet(null);
                  if (m === "installed") onDone();
                }}
                className="flex min-h-11 items-center justify-center gap-1.5 rounded-lg bg-neutral-100 text-sm font-medium dark:bg-neutral-800"
              >
                <Icon name={MARK_LABEL[m].icon} size={14} className={MARK_LABEL[m].tone} /> {MARK_LABEL[m].text}
              </button>
            ))}
          </div>
        </div>
      )}
      <Prompt done={done}>
        {done
          ? "Installed. Staged means dropped off and ready; Locked out means you couldn't get in — a PM with a share link sees it and arranges access; Blocked asks you to say what's wrong."
          : mode === "measure"
            ? nudge
              ? "In Measure mode a tap opens the unit to measure. Flip the switch to Install first."
              : "Install day: flip the switch at the top of the floor to Install."
            : "Now tap a unit and mark it Installed."}
      </Prompt>
    </>
  );
}

// ---------------------------------------------------------------------------
// 8. No signal — work offline, it syncs itself
// ---------------------------------------------------------------------------

export function OfflineDemo({ onDone }: DemoProps) {
  const [signal, setSignal] = useState(false);
  const [pending, setPending] = useState(3);
  const label = !signal ? "offline" : pending > 0 ? `${pending} pending` : "✓ synced";
  return (
    <>
      <div className="flex items-center justify-between gap-3">
        <span className="rounded-full border border-neutral-300 px-3 py-2 text-sm dark:border-neutral-700">{label}</span>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="h-5 w-5" checked={signal} onChange={(e) => setSignal(e.target.checked)} />
          Signal
        </label>
      </div>
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={() => setPending((n) => n + 1)}
          className="min-h-11 flex-1 rounded-lg bg-neutral-100 text-sm font-medium dark:bg-neutral-800"
        >
          Measure a window
        </button>
        <button
          type="button"
          disabled={!signal || pending === 0}
          onClick={() => {
            setPending(0);
            onDone();
          }}
          className="min-h-11 flex-1 rounded-lg bg-blue-600 text-sm font-semibold text-white disabled:opacity-40"
        >
          Sync now
        </button>
      </div>
      <Prompt done={signal && pending === 0}>
        {signal && pending === 0
          ? "Everything's up. In the app this happens by itself when signal comes back — Sync now is only there if you want it right away."
          : !signal
            ? "Basement, no signal. Keep measuring — nothing is lost. Then turn Signal on."
            : "Signal's back. Tap Sync now (or just wait — it goes by itself)."}
      </Prompt>
    </>
  );
}
