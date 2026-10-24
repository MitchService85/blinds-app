"use client";

import type { Deficiency } from "@/lib/types";
import { isCrewIssue } from "@/lib/issues";
import { fixedSummary } from "./window-issue";

interface DeficiencyListProps {
  items: Deficiency[];
  /** Label for a deficiency's blind, when it names one. */
  windowLabel?: (windowId: string) => string;
  /** Unit number, when the list spans several units. */
  unitNumber?: (unitId: string) => string;
  onResolve?: (id: string) => void;
  onReopen?: (id: string) => void;
}

/** "Sep 6" style, for a complaint's date. */
function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/**
 * "PM · Anthony" — marks a deficiency a PM raised through their share link.
 * PM ones are the same amber as the crew's (one colour for "still to fix",
 * v2.8 plan); this chip is the only thing that tells them apart, so every
 * list that shows a PM deficiency uses it.
 */
export function PmChip({ name }: { name: string }) {
  return (
    <span className="inline-flex shrink-0 items-center rounded-full border border-amber-500 bg-white/70 px-1.5 py-px text-[11px] font-semibold leading-4 text-amber-900 dark:border-amber-500 dark:bg-amber-950/60 dark:text-amber-200">
      PM · {name.trim() || "PM"}
    </span>
  );
}

/**
 * Deficiencies raised by an external PM through their share link (see
 * docs/superpowers/specs/2026-09-06-pm-view-design.md), and the unit-level
 * ones on the unit screen. Rendered the same way wherever the crew meets them,
 * in the crew's words: "✓ Mark fixed", then the green "✓ Fixed Oct 23" record.
 */
export function DeficiencyList({ items, windowLabel, unitNumber, onResolve, onReopen }: DeficiencyListProps) {
  if (items.length === 0) return null;
  return (
    <ul className="flex flex-col gap-1.5">
      {items.map((d) => {
        const fixed = d.status === "resolved";
        const pm = !isCrewIssue(d);
        return (
          <li
            key={d.id}
            className={`flex items-start gap-2 rounded-lg px-3 py-2 text-sm ${
              fixed
                ? "bg-neutral-100 text-neutral-700 dark:bg-neutral-800/60 dark:text-neutral-300"
                : "bg-amber-50 text-amber-950 dark:bg-amber-950/40 dark:text-amber-100"
            }`}
          >
            <div className="min-w-0 flex-1">
              <div>
                {unitNumber && <span className="mr-1 font-semibold">{unitNumber(d.unit_id)}</span>}
                {windowLabel && (
                  <span className="mr-1 font-medium">{d.window_id ? windowLabel(d.window_id) : "Whole unit"}:</span>
                )}
                <span>{d.note.trim() || "Deficiency (no note)"}</span>
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px]">
                {pm && <PmChip name={d.raised_by} />}
                <span className="opacity-70">{shortDate(d.raised_at)}</span>
                {fixed && (
                  <span className="font-semibold text-emerald-700 dark:text-emerald-400">{fixedSummary(d)}</span>
                )}
              </div>
            </div>
            {!fixed && onResolve && (
              <button
                type="button"
                onClick={() => onResolve(d.id)}
                className="min-h-11 shrink-0 rounded-lg bg-emerald-600 px-3 text-sm font-semibold text-white active:bg-emerald-700"
              >
                ✓ Mark fixed
              </button>
            )}
            {fixed && onReopen && (
              <button
                type="button"
                onClick={() => onReopen(d.id)}
                className="min-h-11 shrink-0 rounded-lg bg-neutral-200 px-3 text-xs font-medium dark:bg-neutral-700"
              >
                Not fixed after all
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}
