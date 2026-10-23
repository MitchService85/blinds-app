"use client";

import { useState } from "react";
import type { Deficiency, IssueFault } from "@/lib/types";
import { fixedDate, isCrewIssue } from "@/lib/issues";
import { QUICK_NOTES, hasQuickNote, suggestedFixNote, toggleQuickNote } from "@/lib/fixes";

/**
 * The problems on one blind, each its own deficiency (field request,
 * 2026-08-27; one-per-problem since 2026-10-23): what's wrong, whose error it
 * is (factory vs measure — decides who pays a recut), whether it needs a
 * recut, and once fixed, when and what was done. A fixed problem stays listed
 * as the record; a new one on the same blind is a separate entry, completed on
 * its own. Never exported to the factory measure sheet.
 */

export const ISSUE_FAULT_LABEL: Record<Exclude<IssueFault, null>, string> = {
  factory: "Factory error",
  measure: "Measure error",
};

/** One line for lists: what's wrong, then whose error, then recut. */
export function deficiencySummary(d: Pick<Deficiency, "note" | "fault" | "recut">): string {
  return [
    d.note.trim() || "issue",
    d.fault ? ISSUE_FAULT_LABEL[d.fault] : null,
    d.recut ? "recut needed" : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** "✓ Fixed Oct 23 — Shimmed", or "" for an open problem. */
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

/** One-tap "what was done" buttons, shared with fix batches. */
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
            className={`min-h-9 rounded-full border px-3 text-xs font-medium ${
              on
                ? "border-emerald-600 bg-emerald-600 text-white"
                : "border-neutral-300 bg-white dark:border-neutral-700 dark:bg-neutral-900"
            }`}
          >
            {chip}
          </button>
        );
      })}
    </div>
  );
}

/** Note, whose error, recut — the same three fields to add or edit a problem. */
function ProblemFields({
  value,
  onChange,
  autoFocus,
}: {
  value: NewIssue;
  onChange: (patch: Partial<NewIssue>) => void;
  autoFocus?: boolean;
}) {
  return (
    <>
      <input
        type="text"
        value={value.note}
        autoFocus={autoFocus}
        onChange={(e) => onChange({ note: e.target.value })}
        placeholder="What's wrong with this blind? e.g. cut 1/4 short"
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
            className={`min-h-10 flex-1 text-xs font-medium ${
              value.fault === fault
                ? "bg-amber-600 text-white"
                : "bg-white text-neutral-700 dark:bg-neutral-900 dark:text-neutral-300"
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      <label className="flex min-h-10 items-center gap-2 text-xs">
        <input
          type="checkbox"
          checked={value.recut}
          onChange={(e) => onChange({ recut: e.target.checked })}
          className="h-5 w-5"
        />
        <span>
          Needs recut
          {value.fault === "factory" && (
            <span className="text-amber-700 dark:text-amber-400"> — factory&apos;s error, they pay</span>
          )}
        </span>
      </label>
    </>
  );
}

interface BlindIssuesProps {
  /** This blind's problems, open and fixed (not removed). */
  issues: Deficiency[];
  /** The add form is showing (the ⚠ button on the row opens it). */
  adding: boolean;
  onAdd: (issue: NewIssue) => void;
  onCancelAdd: () => void;
  /** Edits to an open problem's note / fault / recut, per keystroke. */
  onEdit: (d: Deficiency) => void;
  onResolve: (id: string, fixNote: string) => void;
  onReopen: (id: string) => void;
  onRemove: (id: string) => void;
  onFixNote: (id: string, fixNote: string) => void;
}

/** One open problem, expanded: its fields, then "Fixed it?". */
function OpenProblem({
  d,
  onEdit,
  onResolve,
  onRemove,
}: {
  d: Deficiency;
  onEdit: BlindIssuesProps["onEdit"];
  onResolve: BlindIssuesProps["onResolve"];
  onRemove: BlindIssuesProps["onRemove"];
}) {
  // Starts from the likely fix ("no deduction" -> New blind installed) so
  // most are one tap.
  const [pending, setPending] = useState(() => suggestedFixNote(d.note));
  const crew = isCrewIssue(d);
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-amber-300 bg-amber-50 p-2 dark:border-amber-700 dark:bg-amber-950/40">
      {crew ? (
        <ProblemFields
          value={{ note: d.note, fault: d.fault ?? null, recut: d.recut === true }}
          onChange={(patch) => onEdit({ ...d, ...patch })}
        />
      ) : (
        // A PM's words stay as they wrote them.
        <div className="text-sm">
          <span className="font-semibold">{d.raised_by || "PM"}:</span> {d.note}
        </div>
      )}
      <div className="flex flex-col gap-2 rounded-lg border border-emerald-300 bg-emerald-50 p-2 dark:border-emerald-800 dark:bg-emerald-950/40">
        <div className="text-xs font-medium text-emerald-800 dark:text-emerald-300">
          Fixed it? It stays listed here as the record.
        </div>
        <input
          type="text"
          value={pending}
          onChange={(e) => setPending(e.target.value)}
          placeholder="What was done, e.g. shimmed"
          aria-label="What was done"
          className="min-h-11 w-full rounded-lg border border-emerald-300 bg-white px-3 text-sm dark:border-emerald-800 dark:bg-neutral-900"
        />
        <FixNoteChips note={pending} onChange={setPending} />
        <button
          type="button"
          onClick={() => onResolve(d.id, pending.trim())}
          className="min-h-11 rounded-lg bg-emerald-600 text-sm font-semibold text-white active:bg-emerald-700"
        >
          ✓ Mark fixed
        </button>
      </div>
      {crew && (
        <button
          type="button"
          onClick={() => onRemove(d.id)}
          className="min-h-9 self-start rounded-lg bg-white px-3 text-xs font-medium text-neutral-600 dark:bg-neutral-900 dark:text-neutral-300"
        >
          Remove (entered by mistake)
        </button>
      )}
    </div>
  );
}

/** One fixed problem, expanded: what was done, and "not fixed after all". */
function FixedProblem({
  d,
  onReopen,
  onFixNote,
}: {
  d: Deficiency;
  onReopen: BlindIssuesProps["onReopen"];
  onFixNote: BlindIssuesProps["onFixNote"];
}) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-emerald-300 bg-emerald-50 p-2 dark:border-emerald-800 dark:bg-emerald-950/40">
      <div className="text-xs text-neutral-600 dark:text-neutral-400">Was: {deficiencySummary(d)}</div>
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-semibold text-emerald-800 dark:text-emerald-300">
          ✓ Fixed{d.resolved_at ? ` ${fixedDate(d.resolved_at)}` : ""}
        </span>
        <button type="button" onClick={() => onReopen(d.id)} className="min-h-9 px-2 text-xs text-blue-600">
          Not fixed after all
        </button>
      </div>
      <input
        type="text"
        value={d.fix_note ?? ""}
        onChange={(e) => onFixNote(d.id, e.target.value)}
        placeholder="What was done"
        aria-label="What was done"
        className="min-h-11 w-full rounded-lg border border-emerald-300 bg-white px-3 text-sm dark:border-emerald-800 dark:bg-neutral-900"
      />
      <FixNoteChips note={d.fix_note ?? ""} onChange={(note) => onFixNote(d.id, note)} />
    </div>
  );
}

/** Everything wrong with one blind, under its row on the unit screen. */
export function BlindIssues({
  issues,
  adding,
  onAdd,
  onCancelAdd,
  onEdit,
  onResolve,
  onReopen,
  onRemove,
  onFixNote,
}: BlindIssuesProps) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [draft, setDraft] = useState<NewIssue>({ note: "", fault: null, recut: false });
  // Open problems first, then the fixed record, each oldest first.
  const sorted = [...issues].sort(
    (a, b) => Number(a.status === "resolved") - Number(b.status === "resolved") || a.raised_at.localeCompare(b.raised_at)
  );
  if (sorted.length === 0 && !adding) return null;
  return (
    <div className="flex flex-col gap-1.5">
      {sorted.map((d) => {
        const fixed = d.status === "resolved";
        if (openId === d.id) {
          return (
            <div key={d.id} className="flex flex-col gap-1">
              <button
                type="button"
                onClick={() => setOpenId(null)}
                className="self-end px-1 text-xs text-blue-600"
              >
                Done
              </button>
              {fixed ? (
                <FixedProblem d={d} onReopen={onReopen} onFixNote={onFixNote} />
              ) : (
                <OpenProblem
                  d={d}
                  onEdit={onEdit}
                  onResolve={(id, note) => {
                    setOpenId(null);
                    onResolve(id, note);
                  }}
                  onRemove={(id) => {
                    setOpenId(null);
                    onRemove(id);
                  }}
                />
              )}
            </div>
          );
        }
        return (
          <button
            key={d.id}
            type="button"
            onClick={() => setOpenId(d.id)}
            className={`text-left text-xs font-medium ${
              fixed ? "text-neutral-500 dark:text-neutral-400" : "text-amber-800 dark:text-amber-300"
            }`}
          >
            {fixed ? "" : "⚠ "}
            {!isCrewIssue(d) && <span className="font-semibold">{d.raised_by || "PM"}: </span>}
            {deficiencySummary(d)}
            {fixed && (
              <span className="mt-0.5 block font-semibold text-emerald-700 dark:text-emerald-400">{fixedSummary(d)}</span>
            )}
          </button>
        );
      })}
      {adding && (
        <div className="flex flex-col gap-2 rounded-lg border border-amber-300 bg-amber-50 p-2 dark:border-amber-700 dark:bg-amber-950/40">
          <div className="text-xs font-semibold text-amber-900 dark:text-amber-200">New problem on this blind</div>
          <ProblemFields value={draft} onChange={(patch) => setDraft((v) => ({ ...v, ...patch }))} autoFocus />
          <div className="flex gap-2">
            <button
              type="button"
              disabled={!draft.note.trim() && draft.fault === null && !draft.recut}
              onClick={() => {
                onAdd(draft);
                setDraft({ note: "", fault: null, recut: false });
              }}
              className="min-h-11 flex-1 rounded-lg bg-amber-600 text-sm font-semibold text-white disabled:opacity-50"
            >
              Add problem
            </button>
            <button
              type="button"
              onClick={() => {
                setDraft({ note: "", fault: null, recut: false });
                onCancelAdd();
              }}
              className="min-h-11 rounded-lg bg-white px-4 text-sm dark:bg-neutral-900"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
