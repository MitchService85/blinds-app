"use client";

import { useEffect } from "react";
import Link from "next/link";
import type { Deficiency, Unit, WindowRecord } from "@/lib/types";
import { Icon } from "@/components/icon";
import { blockedOf, installOf, lockedOf } from "./status";
import { windowBlindCount, windowTagLabel } from "@/lib/export/shared";
import { deficiencySummary, fixedSummary } from "./window-issue";
import { deficiencyOpen, isCrewIssue } from "@/lib/issues";
import { PmChip } from "./deficiency-list";

/**
 * not_started / staged / installed set Unit.install. block asks the floor
 * page for a reason first (it writes install_blocked + the note on Save);
 * unblock and locked are toggles of their own flags.
 */
export type InstallAction = "not_started" | "staged" | "installed" | "block" | "unblock" | "locked";

interface InstallActionSheetProps {
  unit: Unit | null;
  /** The unit's windows — labels the deficiencies on its blinds. */
  windows?: WindowRecord[];
  /** Deficiencies recorded in this unit (open and fixed, any blind or none). */
  issues?: Deficiency[];
  /** The unit screen; deficiency rows add `#w-<window id>` to land on the blind. */
  unitHref: string;
  onAction: (action: InstallAction) => void;
  onOpenUnit: () => void;
  onEditNote: () => void;
  onClose: () => void;
}

const plural = (n: number) => (n === 1 ? "1 deficiency" : `${n} deficiencies`);

/**
 * One sentence under the title saying why the tile looks the way it does.
 * Without it a yellow tile opened onto a sheet that highlighted "Complete" —
 * the crew could not tell what was holding it (v2.8 review).
 */
function statusLine(unit: Unit, open: number): { tone: "amber" | "emerald" | "violet" | "neutral"; text: string } {
  const install = installOf(unit);
  if (unit.status === "na") return { tone: "neutral", text: "N/A — not part of the install" };
  if (lockedOf(unit)) return { tone: "violet", text: "Locked out — couldn't get in" };
  if (blockedOf(unit)) {
    const why = unit.note.trim() || "no reason noted yet";
    return { tone: "amber", text: `Blocked — ${why}${open > 0 ? ` · ${plural(open)} still open` : ""}` };
  }
  const word = install === "done" ? "Installed" : install === "staged" ? "Staged" : "Not started";
  if (install !== null && open > 0)
    return {
      tone: "amber",
      text: `${word} — ${plural(open)} still open, stays blocked until ${open === 1 ? "it's" : "they're"} fixed`,
    };
  if (open > 0) return { tone: "neutral", text: `Not started — ${plural(open)} to check before it goes up` };
  return { tone: install === null ? "neutral" : "emerald", text: word };
}

const TONE: Record<ReturnType<typeof statusLine>["tone"], string> = {
  amber: "bg-amber-100 text-amber-950 dark:bg-amber-950/60 dark:text-amber-100",
  emerald: "bg-emerald-50 text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200",
  violet: "bg-violet-50 text-violet-900 dark:bg-violet-950/40 dark:text-violet-200",
  neutral: "bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300",
};

/**
 * Tap target for an InstallTile (see spec: Install mode). Three rows of
 * controls, each answering one question: how far the install got (Not
 * started / Staged / Installed), whether something stops it (Blocked, Locked
 * out — overlays, independent of progress), and where to go next (Note, Open
 * unit). Every open deficiency the tile counts is listed, so a yellow unit
 * always shows its reason here.
 */
export function InstallActionSheet({
  unit,
  windows,
  issues: unitIssues,
  unitHref,
  onAction,
  onOpenUnit,
  onEditNote,
  onClose,
}: InstallActionSheetProps) {
  // Escape closes it too (keyboard on an iPad, desktop testing).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (!unit) return null;

  const install = installOf(unit);
  const blocked = blockedOf(unit);
  const locked = lockedOf(unit);
  const byId = new Map((windows ?? []).map((w) => [w.id, w]));
  // Every deficiency in the unit, not only those on a listed blind: a PM's
  // complaint about the unit as a whole has no window, and one on a blind
  // deleted since still holds the tile yellow. Dropping those left a yellow
  // unit with no reason on its sheet (v2.8 review, 110).
  const mine = (unitIssues ?? []).filter((d) => !d.deleted);
  const open = mine.filter(deficiencyOpen);
  const fixed = mine.filter((d) => d.status === "resolved");
  const label = (d: Deficiency) => {
    if (!d.window_id) return "Whole unit";
    const w = byId.get(d.window_id);
    return w ? windowTagLabel(w) : "Removed blind";
  };
  const href = (d: Deficiency) => (d.window_id && byId.has(d.window_id) ? `${unitHref}#w-${d.window_id}` : unitHref);
  // Openings vs blinds differ on bays and repeat rows (one 3-panel bay is
  // three blinds, three sets of brackets), so both are worth stating here —
  // this sheet is what the installer opens before starting the unit.
  const blinds = (windows ?? []).reduce((n, w) => n + windowBlindCount(w), 0);
  const openings = (windows ?? []).length;
  const status = statusLine(unit, open.length);
  const note = unit.note.trim();

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="install-sheet-title"
        className="max-h-[calc(100dvh-2rem)] w-full max-w-sm overflow-y-auto overscroll-contain rounded-xl bg-white p-4 dark:bg-neutral-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="-mt-1 -mr-2 mb-2 flex items-center gap-2">
          <span id="install-sheet-title" className="text-base font-semibold">
            Unit {unit.number}
          </span>
          {blinds > 0 && (
            <span className="text-xs text-neutral-500 dark:text-neutral-400">
              {blinds} blind{blinds === 1 ? "" : "s"}
              {openings !== blinds && ` · ${openings} opening${openings === 1 ? "" : "s"}`}
            </span>
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="ml-auto flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-lg text-neutral-500 active:bg-neutral-100 dark:active:bg-neutral-800"
          >
            <Icon name="close" size={20} />
          </button>
        </div>

        <div className={`mb-3 flex items-start gap-2 rounded-lg px-3 py-2 text-sm font-medium ${TONE[status.tone]}`}>
          {status.tone === "amber" && <Icon name="alert" size={16} className="mt-0.5 shrink-0" />}
          {status.tone === "violet" && <Icon name="lock" size={16} className="mt-0.5 shrink-0" />}
          {status.tone === "emerald" && <Icon name="check-circle" size={16} className="mt-0.5 shrink-0" />}
          <span>{status.text}</span>
        </div>

        {/* The note, whatever state the unit is in — "PRIORITY" or "key at
            the desk" matters to whoever opens the sheet. Blocked, it is
            already the reason in the line above. */}
        {note && !blocked && (
          <div className="mb-3 flex items-start gap-2 rounded-lg bg-neutral-100 px-3 py-2 text-sm text-neutral-800 dark:bg-neutral-800 dark:text-neutral-200">
            <Icon name="note" size={16} className="mt-0.5 shrink-0 text-neutral-500" />
            <span>{note}</span>
          </div>
        )}

        {open.length > 0 && (
          <ul className="mb-3 flex flex-col overflow-hidden rounded-lg border border-amber-300 bg-amber-50 text-sm text-amber-950 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-100">
            {open.map((d) => (
              <li key={d.id} className="border-t border-amber-200 first:border-t-0 dark:border-amber-800">
                <Link href={href(d)} className="flex min-h-11 items-center gap-2 px-3 py-2 active:bg-amber-100 dark:active:bg-amber-900/40">
                  <span className="min-w-0 flex-1">
                    <span className="font-semibold">{label(d)}</span> — {deficiencySummary(d)}
                    {!isCrewIssue(d) && (
                      <>
                        {" "}
                        <PmChip name={d.raised_by} />
                      </>
                    )}
                  </span>
                  <span aria-hidden className="shrink-0 text-amber-600">›</span>
                </Link>
              </li>
            ))}
          </ul>
        )}

        {blocked && open.length === 0 && !note && (
          <div className="mb-3 text-xs text-neutral-500 dark:text-neutral-400">
            Nothing recorded yet. Open unit to add a note or a deficiency on a blind.
          </div>
        )}

        {/* How far the install got. Not highlighted on a locked unit with
            nothing started: "Locked out" already says it, and two lit
            buttons for one state read as two answers (v2.8 review). */}
        <div className="mb-2 flex gap-1 rounded-lg bg-neutral-100 p-1 dark:bg-neutral-800">
          {(
            [
              ["not_started", "Not started", null],
              ["staged", "Staged", "staged"],
              ["installed", "Installed", "done"],
            ] as const
          ).map(([action, text, value]) => {
            const active = install === value && !(locked && value === null);
            return (
              <button
                key={action}
                type="button"
                aria-pressed={active}
                onClick={() => onAction(action)}
                className={`min-h-11 flex-1 rounded-md px-1 text-sm font-medium ${
                  active
                    ? "bg-blue-600 font-semibold text-white"
                    : "text-neutral-700 active:bg-white dark:text-neutral-300 dark:active:bg-neutral-700"
                }`}
              >
                {text}
              </button>
            );
          })}
        </div>

        {/* What stops it — overlays, independent of how far it got. Locked
            out is the one the PM sees, because access is theirs to arrange;
            blocked stays internal. */}
        <div className="mb-2 flex gap-2">
          <button
            type="button"
            aria-pressed={blocked}
            onClick={() => onAction(blocked ? "unblock" : "block")}
            className={`flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-lg text-sm font-medium ${
              blocked
                ? "border-2 border-amber-500 bg-amber-300 font-semibold text-amber-950"
                : "bg-neutral-100 text-neutral-800 dark:bg-neutral-800 dark:text-neutral-200"
            }`}
          >
            <Icon name="alert" size={16} className={blocked ? "" : "text-amber-600"} />
            {blocked ? "Unblock" : "Blocked"}
          </button>
          <button
            type="button"
            aria-pressed={locked}
            onClick={() => onAction("locked")}
            className={`flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-lg text-sm font-medium ${
              locked
                ? "bg-violet-600 font-semibold text-white"
                : "bg-neutral-100 text-neutral-800 dark:bg-neutral-800 dark:text-neutral-200"
            }`}
          >
            <Icon name="lock" size={16} className={locked ? "" : "text-violet-600"} />
            Locked out
            {locked && <Icon name="check" size={16} />}
          </button>
        </div>

        <div className="flex gap-2">
          <button
            type="button"
            onClick={onEditNote}
            className="flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-lg bg-neutral-100 text-sm font-medium text-neutral-800 dark:bg-neutral-800 dark:text-neutral-200"
          >
            <Icon name="note" size={16} /> Note
          </button>
          <button
            type="button"
            onClick={onOpenUnit}
            className={`flex min-h-11 flex-[2] items-center justify-center rounded-lg px-2 text-sm font-semibold ${
              open.length > 0
                ? "bg-blue-600 text-white active:bg-blue-700"
                : "bg-neutral-100 text-neutral-800 dark:bg-neutral-800 dark:text-neutral-200"
            }`}
          >
            {open.length > 0 ? `Open unit to fix (${open.length})` : "Open unit"}
          </button>
        </div>

        {fixed.length > 0 && (
          <ul className="mt-3 flex flex-col gap-1 rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200">
            {fixed.map((d) => (
              <li key={d.id}>
                <span className="font-semibold">{label(d)}</span> — {deficiencySummary(d)}.{" "}
                <span className="font-semibold">{fixedSummary(d)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
