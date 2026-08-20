"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import type { Unit, UnitStatus } from "@/lib/types";
import { deriveUnitState, UNIT_STATE_TILE_CLASSES } from "./status";

interface UnitTileProps {
  unit: Unit;
  /** Openings on this unit (rows), used for the not-started / in-progress state. */
  windowCount: number;
  /** Blinds ordered: panels x quantity. Cleveland's L12 is 1 opening, 13 blinds. */
  blindCount: number;
  href: string;
  /** True when lib/checks.ts flagged a bay-symmetry warning on this unit. */
  hasWarning: boolean;
  onSetStatus: (status: UnitStatus) => void;
  onDelete: () => void;
  onOpenNote: () => void;
}

const LONG_PRESS_MS = 500;

/**
 * Floor-grid unit tile: color-coded by derived status, long-press (or the
 * always-visible ⋯ button, for pointer devices / accessibility) opens a
 * quick-action menu (see spec: Floor view). Small corner badges surface a
 * measurement warning (⚠) and/or a punch-list note (📝) without needing to
 * open the tile.
 */
export function UnitTile({
  unit,
  windowCount,
  blindCount,
  href,
  hasWarning,
  onSetStatus,
  onDelete,
  onOpenNote,
}: UnitTileProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function startPress() {
    timerRef.current = setTimeout(() => setMenuOpen(true), LONG_PRESS_MS);
  }
  function cancelPress() {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }

  const state = deriveUnitState(unit.status, windowCount);

  function act(status: UnitStatus) {
    onSetStatus(status);
    setMenuOpen(false);
  }

  return (
    <div className="relative">
      <Link
        href={href}
        onPointerDown={startPress}
        onPointerUp={cancelPress}
        onPointerLeave={cancelPress}
        onPointerMove={cancelPress}
        onClick={(e) => {
          if (menuOpen) e.preventDefault();
        }}
        className={`flex min-h-16 w-full flex-col items-center justify-center gap-0.5 overflow-hidden rounded-lg border px-2 py-2 text-center ${UNIT_STATE_TILE_CLASSES[state]}`}
      >
        {/* Commercial zone labels ("L1- Snake Corridor") can be much longer
            than a residential unit number — truncate with an ellipsis here;
            the unit screen's header shows the name in full. */}
        <span className="w-full truncate text-sm font-semibold" title={unit.number}>
          {unit.number}
        </span>
        <span className="text-[11px] opacity-80">
          {state === "na"
            ? "N/A"
            : blindCount > 0
              ? `${blindCount} blind${blindCount === 1 ? "" : "s"}`
              : "—"}
        </span>
      </Link>

      {(hasWarning || unit.note) && (
        <div className="pointer-events-none absolute -left-1.5 -top-1.5 flex gap-0.5">
          {hasWarning && (
            <span
              title="Check measurements"
              className="flex h-5 w-5 items-center justify-center rounded-full bg-amber-500 text-[10px] leading-none text-white"
            >
              ⚠
            </span>
          )}
          {unit.note && (
            <span
              title={unit.note}
              className="flex h-5 w-5 items-center justify-center rounded-full bg-blue-500 text-[10px] leading-none text-white"
            >
              📝
            </span>
          )}
        </div>
      )}

      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setMenuOpen((v) => !v);
        }}
        aria-label={`Unit ${unit.number} actions`}
        className="absolute -right-1.5 -top-1.5 flex h-7 w-7 items-center justify-center rounded-full bg-neutral-900/70 text-xs text-white dark:bg-white/80 dark:text-neutral-900"
      >
        ⋯
      </button>

      {menuOpen && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
          <div className="absolute right-0 top-full z-20 mt-1 w-36 overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-lg dark:border-neutral-700 dark:bg-neutral-900">
            {unit.status !== "done" && (
              <button
                type="button"
                onClick={() => act("done")}
                className="block min-h-11 w-full px-3 text-left text-sm active:bg-neutral-100 dark:active:bg-neutral-800"
              >
                Mark done
              </button>
            )}
            {unit.status !== "na" && (
              <button
                type="button"
                onClick={() => act("na")}
                className="block min-h-11 w-full px-3 text-left text-sm active:bg-neutral-100 dark:active:bg-neutral-800"
              >
                Mark N/A
              </button>
            )}
            {unit.status !== "active" && (
              <button
                type="button"
                onClick={() => act("active")}
                className="block min-h-11 w-full px-3 text-left text-sm active:bg-neutral-100 dark:active:bg-neutral-800"
              >
                Reopen
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                onOpenNote();
                setMenuOpen(false);
              }}
              className="block min-h-11 w-full px-3 text-left text-sm active:bg-neutral-100 dark:active:bg-neutral-800"
            >
              {unit.note ? "Edit note" : "Note"}
            </button>
            {windowCount === 0 && (
              <button
                type="button"
                onClick={() => {
                  onDelete();
                  setMenuOpen(false);
                }}
                className="block min-h-11 w-full px-3 text-left text-sm text-red-600 active:bg-red-50 dark:active:bg-red-950"
              >
                Delete unit
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
