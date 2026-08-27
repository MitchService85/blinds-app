"use client";

import type { IssueFault, WindowRecord } from "@/lib/types";

/**
 * Per-blind install-issue capture (field request, 2026-08-27): when a unit
 * is blocked, note which individual blinds are wrong, whose error it is
 * (factory vs measure — decides who pays for a recut), and whether a recut
 * is needed. Punch-list data; never exported to the factory measure sheet.
 */

export const ISSUE_FAULT_LABEL: Record<Exclude<IssueFault, null>, string> = {
  factory: "Factory error",
  measure: "Measure error",
};

export type WindowIssueFields = Pick<
  WindowRecord,
  "issue_note" | "issue_fault" | "issue_recut"
>;

export function windowHasIssue(w: WindowIssueFields): boolean {
  return Boolean(w.issue_note) || (w.issue_fault ?? null) !== null || w.issue_recut === true;
}

/** One-line summary for lists: note first, then attribution, then recut. */
export function issueSummary(w: WindowIssueFields): string {
  const parts = [
    w.issue_note || "issue",
    w.issue_fault ? ISSUE_FAULT_LABEL[w.issue_fault] : null,
    w.issue_recut ? "recut needed" : null,
  ].filter(Boolean);
  return parts.join(" · ");
}

interface WindowIssueEditorProps {
  value: WindowIssueFields;
  onChange: (patch: Partial<WindowIssueFields>) => void;
  onClear: () => void;
}

/** Inline editor rendered under a window row on the unit screen. */
export function WindowIssueEditor({ value, onChange, onClear }: WindowIssueEditorProps) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-amber-300 bg-amber-50 p-2 dark:border-amber-700 dark:bg-amber-950/40">
      <input
        type="text"
        value={value.issue_note ?? ""}
        onChange={(e) => onChange({ issue_note: e.target.value })}
        placeholder="What's wrong with this blind? e.g. cut 1/4 short"
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
            onClick={() => onChange({ issue_fault: fault })}
            aria-pressed={(value.issue_fault ?? null) === fault}
            className={`min-h-10 flex-1 text-xs font-medium ${
              (value.issue_fault ?? null) === fault
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
          checked={value.issue_recut === true}
          onChange={(e) => onChange({ issue_recut: e.target.checked })}
          className="h-5 w-5"
        />
        <span>
          Needs recut
          {value.issue_fault === "factory" && (
            <span className="text-amber-700 dark:text-amber-400"> — factory&apos;s error, they pay</span>
          )}
        </span>
      </label>
      <button
        type="button"
        onClick={onClear}
        className="min-h-9 self-start rounded-lg bg-white px-3 text-xs font-medium text-neutral-600 dark:bg-neutral-900 dark:text-neutral-300"
      >
        Clear issue
      </button>
    </div>
  );
}
