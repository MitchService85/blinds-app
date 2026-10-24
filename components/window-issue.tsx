"use client";

import { useEffect, useRef, useState, type KeyboardEvent, type RefObject } from "react";
import type { Deficiency, IssueFault } from "@/lib/types";
import { fixedDate, isCrewIssue } from "@/lib/issues";
import { QUICK_NOTES, hasQuickNote, suggestedFixNote, toggleQuickNote } from "@/lib/fixes";
import { Icon } from "@/components/icon";

/**
 * The deficiencies on one blind (or on the unit as a whole), each its own
 * row (field request, 2026-08-27; one per deficiency since 2026-10-23): what's
 * wrong, whose error it is (factory vs measure — decides who pays a recut),
 * whether it needs a recut, and once fixed, when and what was done. A fixed
 * one stays listed as the record; a new one on the same blind is a separate
 * entry, fixed on its own. Never exported to the factory measure sheet.
 *
 * Fixing is what the crew comes back here to do, far more often than
 * recording ("it is starting to feel complicated", Mitch, 2026-10-24, about a
 * screen that opened every deficiency as an edit form with the fix tucked
 * underneath). So a tap opens the fix — what's wrong as plain text, the
 * what-was-done chips and ✓ Mark fixed on one screen — and editing what was
 * recorded is one "Change" tap away.
 */

export const ISSUE_FAULT_LABEL: Record<Exclude<IssueFault, null>, string> = {
  factory: "Factory error",
  measure: "Measure error",
};

/** One line for lists: what's wrong, then whose error, then recut. */
export function deficiencySummary(d: Pick<Deficiency, "note" | "fault" | "recut">): string {
  return [
    d.note.trim() || "Deficiency (no note)",
    d.fault ? ISSUE_FAULT_LABEL[d.fault] : null,
    d.recut ? "needs recut" : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** "✓ Fixed Oct 23 — Shimmed", or "" for an open deficiency. */
export function fixedSummary(d: Pick<Deficiency, "status" | "resolved_at" | "fix_note">): string {
  if (d.status !== "resolved") return "";
  const note = (d.fix_note ?? "").trim();
  return `✓ Fixed${d.resolved_at ? ` ${fixedDate(d.resolved_at)}` : ""}${note ? ` — ${note}` : ""}`;
}

export interface NewIssue {
  note: string;
  fault: IssueFault;
  recut: boolean;
}

/**
 * Which deficiency panel is open on the unit screen — at most one, across
 * every blind, so two half-filled forms can never be on screen at once.
 * `wasFixed` is the deficiency's state when its panel opened: the list sorts
 * by it rather than by the live status, so a deficiency just marked fixed
 * stays where the thumb is until its panel closes instead of jumping to the
 * bottom of the list mid-tap.
 */
export type IssuePanel =
  | { kind: "add"; windowId: string }
  | { kind: "deficiency"; id: string; wasFixed: boolean }
  | null;

/**
 * Enter on a one-line field: put the keyboard away and bring the button that
 * finishes the job into view. The "done" key on an iOS keyboard otherwise
 * does nothing, and the keyboard was sitting over ✓ Mark fixed.
 */
function doneOnEnter(target: RefObject<HTMLButtonElement | null>) {
  return (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    e.currentTarget.blur();
    // After the keyboard has gone, or the scroll is measured against the
    // half-height viewport it leaves behind.
    window.setTimeout(() => target.current?.scrollIntoView({ block: "center", behavior: "smooth" }), 250);
  };
}

/** "PM · Anthony" — a deficiency from a PM's share link, not the crew. */
function PmChip({ d }: { d: Pick<Deficiency, "raised_by"> }) {
  const who = d.raised_by.trim();
  return (
    <span className="inline-flex shrink-0 items-center rounded-full border border-amber-400 bg-white px-2 text-[11px] font-semibold leading-5 text-amber-900 dark:border-amber-600 dark:bg-neutral-900 dark:text-amber-200">
      {who && who !== "PM" ? `PM · ${who}` : "PM"}
    </span>
  );
}

/** One-tap "what was done" buttons, shared with deficiency batches. */
function FixNoteChips({ note, onChange }: { note: string; onChange: (note: string) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {QUICK_NOTES.map((chip) => {
        const on = hasQuickNote(note, chip);
        return (
          <button
            key={chip}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(toggleQuickNote(note, chip))}
            className={`min-h-11 rounded-full border px-3.5 text-sm font-medium ${
              on
                ? "border-emerald-600 bg-emerald-600 text-white"
                : "border-neutral-300 bg-white text-neutral-800 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200"
            }`}
          >
            {on ? "✓ " : ""}
            {chip}
          </button>
        );
      })}
    </div>
  );
}

/** The "What was done" box under the chips. */
function FixNoteInput({
  value,
  onChange,
  doneTarget,
}: {
  value: string;
  onChange: (note: string) => void;
  doneTarget: RefObject<HTMLButtonElement | null>;
}) {
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={doneOnEnter(doneTarget)}
      enterKeyHint="done"
      placeholder="Or type it, e.g. shimmed left side"
      aria-label="What was done"
      className="min-h-11 w-full rounded-lg border border-neutral-300 bg-white px-3 text-sm dark:border-neutral-700 dark:bg-neutral-900"
    />
  );
}

/** Note, whose error, recut — the same three fields to add or change a deficiency. */
function ProblemFields({
  value,
  onChange,
  autoFocus,
  doneTarget,
}: {
  value: NewIssue;
  onChange: (patch: Partial<NewIssue>) => void;
  autoFocus?: boolean;
  doneTarget: RefObject<HTMLButtonElement | null>;
}) {
  return (
    <>
      <input
        type="text"
        value={value.note}
        autoFocus={autoFocus}
        onChange={(e) => onChange({ note: e.target.value })}
        onKeyDown={doneOnEnter(doneTarget)}
        enterKeyHint="done"
        placeholder="What's wrong? e.g. cut 1/4 short"
        aria-label="What's wrong"
        className="min-h-11 w-full rounded-lg border border-amber-300 bg-white px-3 text-sm dark:border-amber-700 dark:bg-neutral-900"
      />
      <div className="flex overflow-hidden rounded-lg border border-amber-300 dark:border-amber-700">
        {(
          [
            ["factory", "Factory error"],
            ["measure", "Measure error"],
            [null, "Not sure"],
          ] as Array<[IssueFault, string]>
        ).map(([fault, label]) => (
          <button
            key={label}
            type="button"
            onClick={() => onChange({ fault })}
            aria-pressed={value.fault === fault}
            className={`min-h-11 flex-1 text-xs font-medium ${
              value.fault === fault
                ? "bg-amber-600 text-white"
                : "bg-white text-neutral-700 dark:bg-neutral-900 dark:text-neutral-300"
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      <label className="flex min-h-11 items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={value.recut}
          onChange={(e) => onChange({ recut: e.target.checked })}
          className="h-5 w-5"
        />
        <span>
          Needs recut
          {value.recut && value.fault === "factory" && (
            <span className="text-amber-700 dark:text-amber-400"> — factory&apos;s error, they pay</span>
          )}
          {value.recut && value.fault === "measure" && (
            <span className="text-amber-700 dark:text-amber-400"> — our error, we pay</span>
          )}
        </span>
      </label>
    </>
  );
}

/** Full-width Close at the foot of an open panel (it replaced a 20px "Done" link). */
function CloseButton({ onClose, buttonRef }: { onClose: () => void; buttonRef?: RefObject<HTMLButtonElement | null> }) {
  return (
    <button
      ref={buttonRef}
      type="button"
      onClick={onClose}
      className="min-h-11 w-full rounded-lg border border-neutral-300 bg-white text-sm font-medium text-neutral-700 active:bg-neutral-100 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200"
    >
      Close
    </button>
  );
}

interface BlindIssuesProps {
  /** This blind's deficiencies, open and fixed (not removed). */
  issues: Deficiency[];
  /** The blind they're on; null for the whole-unit list, which has no add form. */
  windowId: string | null;
  /** The one open panel on the screen (see IssuePanel). */
  panel: IssuePanel;
  onPanel: (panel: IssuePanel) => void;
  /** Where a deficiency is, when the list itself doesn't say (e.g. a blind since deleted). */
  placeLabel?: (d: Deficiency) => string | null;
  /** Needed only with a windowId: the whole-unit list has no add form. */
  onAdd?: (issue: NewIssue) => void;
  /** Edits to an open deficiency's note / fault / recut, per keystroke. */
  onEdit: (d: Deficiency) => void;
  onResolve: (id: string, fixNote: string) => void;
  onReopen: (id: string) => void;
  onRemove: (id: string) => void;
  onFixNote: (id: string, fixNote: string) => void;
}

/** One open deficiency, tapped: what's wrong as text, then the fix. */
function OpenProblem({
  d,
  place,
  onEdit,
  onResolve,
  onRemove,
  onClose,
}: {
  d: Deficiency;
  place: string | null;
  onEdit: BlindIssuesProps["onEdit"];
  onResolve: BlindIssuesProps["onResolve"];
  onRemove: BlindIssuesProps["onRemove"];
  onClose: () => void;
}) {
  // A note already written (it was fixed once, then "not fixed after all")
  // comes back as it was — starting from the suggestion instead had ✓ Mark
  // fixed quietly overwrite it. Otherwise the likely fix ("no deduction" ->
  // New blind installed), so most are one tap.
  const [pending, setPending] = useState(() => d.fix_note?.trim() || suggestedFixNote(d.note));
  const [changing, setChanging] = useState(false);
  const markRef = useRef<HTMLButtonElement>(null);
  const crew = isCrewIssue(d);
  // A row near the foot of the screen opens with ✓ Mark fixed below the
  // fold; bring the whole fix up to it rather than make the thumb scroll.
  // A frame later, once the panel it replaced (another blind's add form,
  // say) has gone and taken its height with it.
  useEffect(() => {
    const raf = requestAnimationFrame(() =>
      markRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" })
    );
    return () => cancelAnimationFrame(raf);
  }, []);
  return (
    <div
      id={`d-${d.id}`}
      className="flex flex-col gap-3 rounded-lg border-2 border-amber-400 bg-amber-50 p-3 dark:border-amber-600 dark:bg-amber-950/40"
    >
      {changing ? (
        <div className="flex flex-col gap-2">
          <div className="text-xs font-semibold text-amber-900 dark:text-amber-200">Change what was recorded</div>
          <ProblemFields
            value={{ note: d.note, fault: d.fault ?? null, recut: d.recut === true }}
            onChange={(patch) => onEdit({ ...d, ...patch })}
            autoFocus
            doneTarget={markRef}
          />
          <button
            type="button"
            onClick={() => onRemove(d.id)}
            className="min-h-11 self-start rounded-lg border border-neutral-300 bg-white px-3 text-xs font-medium text-neutral-600 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300"
          >
            Remove (entered by mistake)
          </button>
        </div>
      ) : (
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            {place && <div className="text-xs font-medium text-neutral-500 dark:text-neutral-400">{place}</div>}
            <div className="text-sm font-semibold text-amber-950 dark:text-amber-100">
              <Icon name="alert" size={16} className="mr-1" />
              {d.note.trim() || "Deficiency (no note)"}
            </div>
            {(!crew || d.fault || d.recut) && (
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {!crew && <PmChip d={d} />}
                {d.fault && (
                  <span className="rounded-full bg-amber-200/70 px-2 text-[11px] font-medium leading-5 text-amber-950 dark:bg-amber-900/60 dark:text-amber-100">
                    {ISSUE_FAULT_LABEL[d.fault]}
                  </span>
                )}
                {d.recut && (
                  <span className="rounded-full bg-amber-200/70 px-2 text-[11px] font-medium leading-5 text-amber-950 dark:bg-amber-900/60 dark:text-amber-100">
                    Needs recut
                  </span>
                )}
              </div>
            )}
          </div>
          {/* A PM's words stay as they wrote them: only the crew's own
              entries can be changed or removed here. */}
          {crew && (
            <button
              type="button"
              onClick={() => setChanging(true)}
              className="min-h-11 shrink-0 rounded-lg border border-amber-300 bg-white px-3 text-xs font-medium text-amber-900 dark:border-amber-700 dark:bg-neutral-900 dark:text-amber-200"
            >
              Change
            </button>
          )}
        </div>
      )}
      <div className="flex flex-col gap-2">
        <div className="text-xs font-semibold text-neutral-700 dark:text-neutral-300">What was done</div>
        <FixNoteChips note={pending} onChange={setPending} />
        <FixNoteInput value={pending} onChange={setPending} doneTarget={markRef} />
        <button
          ref={markRef}
          type="button"
          onClick={() => onResolve(d.id, pending.trim())}
          className="min-h-12 w-full rounded-lg bg-emerald-600 text-base font-semibold text-white active:bg-emerald-700"
        >
          ✓ Mark fixed
        </button>
      </div>
      <CloseButton onClose={onClose} />
    </div>
  );
}

/** One fixed deficiency, tapped: what was done, and "not fixed after all". */
function FixedProblem({
  d,
  place,
  onReopen,
  onFixNote,
  onClose,
}: {
  d: Deficiency;
  place: string | null;
  onReopen: BlindIssuesProps["onReopen"];
  onFixNote: BlindIssuesProps["onFixNote"];
  onClose: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  return (
    <div
      id={`d-${d.id}`}
      className="flex flex-col gap-3 rounded-lg border-2 border-emerald-400 bg-emerald-50 p-3 dark:border-emerald-700 dark:bg-emerald-950/40"
    >
      <div>
        {place && <div className="text-xs font-medium text-neutral-500 dark:text-neutral-400">{place}</div>}
        <div className="flex flex-wrap items-center gap-1.5 text-xs text-neutral-600 dark:text-neutral-400">
          <span>Was: {deficiencySummary(d)}</span>
          {!isCrewIssue(d) && <PmChip d={d} />}
        </div>
        <div className="mt-1 text-sm font-semibold text-emerald-800 dark:text-emerald-300">
          ✓ Fixed{d.resolved_at ? ` ${fixedDate(d.resolved_at)}` : ""}
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <div className="text-xs font-semibold text-neutral-700 dark:text-neutral-300">What was done</div>
        <FixNoteChips note={d.fix_note ?? ""} onChange={(note) => onFixNote(d.id, note)} />
        <FixNoteInput value={d.fix_note ?? ""} onChange={(note) => onFixNote(d.id, note)} doneTarget={closeRef} />
      </div>
      <button
        type="button"
        onClick={() => onReopen(d.id)}
        className="min-h-11 self-start rounded-lg border border-neutral-400 bg-white px-4 text-sm font-medium text-neutral-800 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-200"
      >
        Not fixed after all
      </button>
      <CloseButton onClose={onClose} buttonRef={closeRef} />
    </div>
  );
}

/** A new deficiency on this blind. */
function AddProblem({ onAdd, onCancel }: { onAdd: (issue: NewIssue) => void; onCancel: () => void }) {
  const [draft, setDraft] = useState<NewIssue>({ note: "", fault: null, recut: false });
  const addRef = useRef<HTMLButtonElement>(null);
  return (
    <div className="flex flex-col gap-2 rounded-lg border-2 border-amber-400 bg-amber-50 p-3 dark:border-amber-600 dark:bg-amber-950/40">
      <div className="text-xs font-semibold text-amber-900 dark:text-amber-200">New deficiency on this blind</div>
      <ProblemFields
        value={draft}
        onChange={(patch) => setDraft((v) => ({ ...v, ...patch }))}
        autoFocus
        doneTarget={addRef}
      />
      <div className="flex gap-2">
        <button
          ref={addRef}
          type="button"
          disabled={!draft.note.trim() && draft.fault === null && !draft.recut}
          onClick={() => onAdd(draft)}
          className="min-h-11 flex-1 rounded-lg bg-amber-600 text-sm font-semibold text-white active:bg-amber-700 disabled:opacity-50"
        >
          Add deficiency
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="min-h-11 rounded-lg border border-neutral-300 bg-white px-4 text-sm font-medium dark:border-neutral-700 dark:bg-neutral-900"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

/** A deficiency, closed: one 44px row, tapped to fix it (or, once fixed, to edit the record). */
function ProblemRow({ d, place, onOpen }: { d: Deficiency; place: string | null; onOpen: () => void }) {
  const fixed = d.status === "resolved";
  const crew = isCrewIssue(d);
  return (
    <button
      id={`d-${d.id}`}
      type="button"
      onClick={onOpen}
      className={`flex min-h-11 w-full items-center gap-2 rounded-lg border px-3 py-2 text-left ${
        fixed
          ? "border-neutral-200 bg-neutral-100 dark:border-neutral-800 dark:bg-neutral-800/60"
          : "border-amber-300 bg-amber-100 active:bg-amber-200 dark:border-amber-700 dark:bg-amber-900/40"
      }`}
    >
      <span className="min-w-0 flex-1">
        {place && (
          <span className="block text-[11px] font-medium text-neutral-500 dark:text-neutral-400">{place}</span>
        )}
        {fixed ? (
          <>
            <span className="flex flex-wrap items-center gap-1.5 text-xs text-neutral-500 dark:text-neutral-400">
              <span>Was: {deficiencySummary(d)}</span>
              {!crew && <PmChip d={d} />}
            </span>
            <span className="block text-sm font-semibold text-emerald-700 dark:text-emerald-400">
              {fixedSummary(d)}
            </span>
          </>
        ) : (
          <span className="flex flex-wrap items-center gap-1.5 text-sm font-medium text-amber-950 dark:text-amber-100">
            <span>
              <Icon name="alert" size={14} className="mr-1" />
              {deficiencySummary(d)}
            </span>
            {!crew && <PmChip d={d} />}
          </span>
        )}
      </span>
      <span
        className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold ${
          fixed
            ? "border border-neutral-300 bg-white text-neutral-700 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-200"
            : "bg-amber-600 text-white"
        }`}
      >
        {fixed ? "Edit ›" : "Fix ›"}
      </span>
    </button>
  );
}

/** Everything wrong with one blind, under its row on the unit screen — or, with no blind, with the unit. */
export function BlindIssues({
  issues,
  windowId,
  panel,
  onPanel,
  placeLabel,
  onAdd,
  onEdit,
  onResolve,
  onReopen,
  onRemove,
  onFixNote,
}: BlindIssuesProps) {
  const openId = panel?.kind === "deficiency" ? panel.id : null;
  const adding = windowId !== null && panel?.kind === "add" && panel.windowId === windowId;
  // Fixed as the list sorts it: the open panel's deficiency keeps the state
  // it had when tapped (see IssuePanel).
  const sortsFixed = (d: Deficiency) =>
    panel?.kind === "deficiency" && panel.id === d.id ? panel.wasFixed : d.status === "resolved";
  // Open ones first, then the fixed record, each oldest first.
  const sorted = [...issues].sort(
    (a, b) => Number(sortsFixed(a)) - Number(sortsFixed(b)) || a.raised_at.localeCompare(b.raised_at)
  );
  if (sorted.length === 0 && windowId === null) return null;
  const close = () => onPanel(null);
  return (
    <div className="flex flex-col gap-1.5">
      {sorted.map((d) => {
        const place = placeLabel?.(d) ?? null;
        if (openId !== d.id) {
          return (
            <ProblemRow
              key={d.id}
              d={d}
              place={place}
              onOpen={() => onPanel({ kind: "deficiency", id: d.id, wasFixed: d.status === "resolved" })}
            />
          );
        }
        return d.status === "resolved" ? (
          <FixedProblem
            key={d.id}
            d={d}
            place={place}
            onFixNote={onFixNote}
            onClose={close}
            onReopen={(id) => {
              // Closed, so tapping it again starts the fix fresh from the
              // note it was fixed with.
              close();
              onReopen(id);
            }}
          />
        ) : (
          <OpenProblem
            key={d.id}
            d={d}
            place={place}
            onEdit={onEdit}
            onClose={close}
            // Stays open, now showing the fixed record, until Close: the
            // confirmation and the way back are both under the thumb.
            onResolve={onResolve}
            onRemove={onRemove}
          />
        );
      })}
      {windowId !== null &&
        (adding ? (
          <AddProblem onAdd={(issue) => onAdd?.(issue)} onCancel={close} />
        ) : (
          // Neutral whatever the blind's state: the rows above carry the
          // status, this only ever adds one.
          <button
            type="button"
            onClick={() => onPanel({ kind: "add", windowId })}
            className="min-h-11 self-start rounded-lg border border-dashed border-neutral-400 bg-white px-4 text-sm font-medium text-neutral-700 active:bg-neutral-100 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-200"
          >
            + Deficiency
          </button>
        ))}
    </div>
  );
}
