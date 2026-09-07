"use client";

import type { Deficiency } from "@/lib/types";

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
 * Deficiencies raised by an external PM through their share link (see
 * docs/superpowers/specs/2026-09-06-pm-view-design.md). Rendered the same
 * way on the floor screen, the unit screen and the project hub so a
 * complaint reads identically wherever the crew meets it.
 */
export function DeficiencyList({ items, windowLabel, unitNumber, onResolve, onReopen }: DeficiencyListProps) {
  if (items.length === 0) return null;
  return (
    <ul className="flex flex-col gap-1.5">
      {items.map((d) => {
        const resolved = d.status === "resolved";
        return (
          <li
            key={d.id}
            className={`flex items-start gap-2 rounded-lg px-3 py-2 text-sm ${
              resolved
                ? "bg-neutral-100 text-neutral-500 dark:bg-neutral-800/60 dark:text-neutral-400"
                : "bg-rose-50 text-rose-900 dark:bg-rose-950/40 dark:text-rose-200"
            }`}
          >
            <div className="min-w-0 flex-1">
              <div>
                {unitNumber && <span className="mr-1 font-semibold">{unitNumber(d.unit_id)}</span>}
                {d.window_id && windowLabel && (
                  <span className="mr-1 font-medium">{windowLabel(d.window_id)}:</span>
                )}
                <span className={resolved ? "line-through" : ""}>{d.note}</span>
              </div>
              <div className="mt-0.5 text-[11px] opacity-70">
                {d.raised_by || "PM"} · {shortDate(d.raised_at)}
                {resolved && d.resolved_at && ` · resolved ${shortDate(d.resolved_at)}`}
              </div>
            </div>
            {!resolved && onResolve && (
              <button
                type="button"
                onClick={() => onResolve(d.id)}
                className="min-h-9 shrink-0 rounded-lg bg-rose-600 px-3 text-xs font-semibold text-white active:bg-rose-700"
              >
                Resolve
              </button>
            )}
            {resolved && onReopen && (
              <button
                type="button"
                onClick={() => onReopen(d.id)}
                className="min-h-9 shrink-0 rounded-lg bg-neutral-200 px-3 text-xs font-medium dark:bg-neutral-700"
              >
                Reopen
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}
