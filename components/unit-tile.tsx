"use client";

import { useRef, useState } from "react";
import { Icon } from "@/components/icon";
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
  /** True when lib/checks.ts flagged anything on this unit. */
  hasWarning: boolean;
  /** Show the reasons. The badge is the only place the flag is visible. */
  onShowWarnings: () => void;
  /** Distinct rooms measured here, in walking order — see lib/tags.ts. */
  rooms: string[];
  onSetStatus: (status: UnitStatus) => void;
  onDelete: () => void;
  onOpenNote: () => void;
}

const LONG_PRESS_MS = 500;
/** Rooms shown before the line collapses to "+N" — four fits a tile at 390px. */
const MAX_ROOMS_ON_TILE = 4;
/**
 * Room the action menu needs below a tile. Measured at 206px in the browser
 * (four rows, the Delete label running long on a unit with windows); the
 * margin above that only means it flips upward a little sooner.
 */
const MENU_HEIGHT_PX = 230;

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
  onShowWarnings,
  rooms,
  onSetStatus,
  onDelete,
  onOpenNote,
}: UnitTileProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuUp, setMenuUp] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /**
   * Opens the menu below the tile, or above it when there is no room below.
   * It only ever opened downward, so on the last row or two of a floor it
   * dropped behind the Done/Export bar — and on the very last row, Delete
   * landed below the bottom of the screen with no more page to scroll. The
   * usable bottom is the pinned bar's top edge, read off the bar itself
   * rather than guessed, since its height changes with the safe area.
   */
  function openMenu() {
    const tile = rootRef.current?.getBoundingClientRect();
    const bar = document.querySelector('[data-pinned="true"]')?.getBoundingClientRect();
    const usableBottom = bar ? bar.top : window.innerHeight;
    setMenuUp(!!tile && tile.bottom + MENU_HEIGHT_PX > usableBottom && tile.top > MENU_HEIGHT_PX);
    setMenuOpen(true);
  }

  function startPress() {
    timerRef.current = setTimeout(openMenu, LONG_PRESS_MS);
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
    <div ref={rootRef} className="relative">
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
        {/* The rooms, above the count: this line is what makes an odd unit
            visible without opening it, and it is only useful when the eye can
            run down a column of them. Capped so one big unit cannot push the
            whole grid taller; the full list is the title. */}
        {state !== "na" && rooms.length > 0 && (
          <span
            className="flex w-full items-baseline justify-center gap-1 text-[10px] leading-tight font-medium opacity-90"
            title={rooms.join(" · ")}
          >
            <span className="truncate">{rooms.slice(0, MAX_ROOMS_ON_TILE).join(" ")}</span>
            {rooms.length > MAX_ROOMS_ON_TILE && (
              <span className="shrink-0">+{rooms.length - MAX_ROOMS_ON_TILE}</span>
            )}
          </span>
        )}
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
          {/* Tappable, because `title` is the one thing iOS never surfaces:
              there is no hover and no long-press tooltip, so the badge was a
              dead end — an amber dot that said a unit was wrong and offered
              no way to find out how ("801 has the warning symbol but no note
              as to why", 2026-10-06). The checks already carry a sentence
              each; this is what reaches it. */}
          {hasWarning && (
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onShowWarnings();
              }}
              aria-label={`Why unit ${unit.number} is flagged`}
              title="Why this is flagged"
              // The dot stays 20px; the pseudo-element gives it a finger-sized
              // target, since a 20px badge on a glove is a miss.
              className="pointer-events-auto relative flex h-5 w-5 items-center justify-center rounded-full bg-amber-500 text-white after:absolute after:-inset-2 after:content-['']"
            >
              <Icon name="alert" size={12} />
            </button>
          )}
          {unit.note && (
            <span
              title={unit.note}
              className="flex h-5 w-5 items-center justify-center rounded-full bg-blue-500 text-white"
            >
              <Icon name="note" size={12} />
            </span>
          )}
        </div>
      )}

      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (menuOpen) setMenuOpen(false);
          else openMenu();
        }}
        aria-label={`Unit ${unit.number} actions`}
        className="absolute -right-2 -top-2 flex h-9 w-9 items-center justify-center rounded-full bg-neutral-900/70 text-white dark:bg-white/80 dark:text-neutral-900"
      >
        <Icon name="more" size={16} />
      </button>

      {menuOpen && (
        <>
          {/* Above the pinned bottom bar (z-30), and below the sheets (z-50).
              The backdrop covers the bar too, so a tap there closes the menu
              rather than firing Done underneath it. */}
          <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
          <div
            className={`absolute left-0 right-0 z-40 overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-lg dark:border-neutral-700 dark:bg-neutral-900 ${
              menuUp ? "bottom-full mb-1" : "top-full mt-1"
            }`}
          >
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
            {/* Always offered. It used to appear only for an empty unit, which
                left a test unit with one window undeletable and gave no hint
                why; the floor page confirms with what goes along with it. */}
            <button
              type="button"
              onClick={() => {
                onDelete();
                setMenuOpen(false);
              }}
              className="block min-h-11 w-full px-3 text-left text-sm text-red-600 active:bg-red-50 dark:active:bg-red-950"
            >
              {windowCount === 0
                ? "Delete unit"
                : `Delete unit + ${windowCount} window${windowCount === 1 ? "" : "s"}`}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
