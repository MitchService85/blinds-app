"use client";

import { useEffect, useState } from "react";
import { formatFraction, floorToEighth } from "@/lib/fractions";

export type Precision = 8 | 16;

const PRECISION_STORAGE_KEY = "measure:precision";
const MAX_WHOLE_DIGITS = 3;

/** Precision switch (⅛ / ¹⁄₁₆), persisted per device (see spec: Window entry). */
export function usePrecision(): [Precision, (p: Precision) => void] {
  const [precision, setPrecisionState] = useState<Precision>(8);

  useEffect(() => {
    const stored = window.localStorage.getItem(PRECISION_STORAGE_KEY);
    // One-time sync from an external store (localStorage) on mount, guarded
    // to client-only so the server-rendered/hydration-time default (8) never
    // mismatches — not a props/state mirroring anti-pattern.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (stored === "16") setPrecisionState(16);
  }, []);

  const setPrecision = (p: Precision) => {
    setPrecisionState(p);
    window.localStorage.setItem(PRECISION_STORAGE_KEY, String(p));
  };

  return [precision, setPrecision];
}

const EIGHTHS = [0, 2, 4, 6, 8, 10, 12, 14]; // as sixteenths
const SIXTEENTHS = Array.from({ length: 16 }, (_, i) => i);

function fractionLabel(sixteenths: number): string {
  if (sixteenths === 0) return "0";
  return formatFraction(sixteenths);
}

interface KeypadProps {
  valueSixteenths: number;
  onChange: (sixteenths: number) => void;
  precision: Precision;
  onPrecisionChange: (p: Precision) => void;
}

/**
 * On-screen whole-inches + fraction keypad. Never opens the OS keyboard —
 * every digit is a button tap (see spec: Window entry). Seeds its digit
 * buffer from `valueSixteenths` once at mount only; the caller is
 * responsible for passing a `key` prop that changes whenever the *target*
 * field changes (e.g. "width-0" -> "height", or a different window loaded
 * for edit) so React remounts a fresh Keypad instead of this component
 * trying to reconcile old typing state against a new field — the standard
 * "reset state via key" pattern for props-driven resets.
 */
export function Keypad({ valueSixteenths, onChange, precision, onPrecisionChange }: KeypadProps) {
  const [whole, setWhole] = useState(() => String(Math.floor(valueSixteenths / 16)));
  const [frac, setFrac] = useState(() => valueSixteenths % 16);
  // True until the first digit is tapped. The buffer still holds the seeded
  // value (e.g. the sticky height prefill of 87) — the first digit should
  // REPLACE that, not append to it, or "87" + tap 6 + tap 3 yields 876.
  const [pristine, setPristine] = useState(true);

  const commit = (nextWhole: string, nextFrac: number) => {
    const wholeNum = nextWhole === "" ? 0 : parseInt(nextWhole, 10);
    onChange(wholeNum * 16 + nextFrac);
  };

  const tapDigit = (d: string) => {
    const base = pristine || whole === "0" ? "" : whole;
    const next = base + d;
    if (next.replace(/^0+/, "").length > MAX_WHOLE_DIGITS) return;
    setPristine(false);
    setWhole(next);
    commit(next, frac);
  };

  const tapBackspace = () => {
    setPristine(false);
    const next = whole.slice(0, -1);
    setWhole(next);
    commit(next, frac);
  };

  const tapClear = () => {
    setPristine(false);
    setWhole("0");
    setFrac(0);
    commit("0", 0);
  };

  const tapFraction = (sixteenths: number) => {
    setPristine(false);
    setFrac(sixteenths);
    commit(whole, sixteenths);
  };

  const raw = (whole === "" ? 0 : parseInt(whole, 10)) * 16 + frac;
  const displaySixteenths = floorToEighth(raw);
  const hasHint = precision === 16 && displaySixteenths !== raw;
  const fractionOptions = precision === 16 ? SIXTEENTHS : EIGHTHS;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-end justify-between gap-3">
        <div>
          <div className="font-mono text-4xl font-semibold tabular-nums">
            {formatFraction(displaySixteenths)}
            <span className="ml-1 text-lg font-normal text-neutral-500">in</span>
          </div>
          {hasHint && (
            <div className="text-sm text-neutral-500 dark:text-neutral-400">
              from {formatFraction(raw)}
            </div>
          )}
        </div>
        <div className="flex overflow-hidden rounded-lg border border-neutral-300 dark:border-neutral-700">
          {([8, 16] as Precision[]).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => onPrecisionChange(p)}
              className={`min-h-11 min-w-11 px-3 text-sm font-medium ${
                precision === p
                  ? "bg-blue-600 text-white"
                  : "bg-white text-neutral-600 dark:bg-neutral-900 dark:text-neutral-300"
              }`}
              aria-pressed={precision === p}
            >
              {p === 8 ? "⅛" : "¹⁄₁₆"}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2">
        {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
          <button
            key={d}
            type="button"
            onClick={() => tapDigit(d)}
            className="min-h-14 rounded-lg bg-neutral-100 text-xl font-medium active:bg-neutral-200 dark:bg-neutral-800 dark:active:bg-neutral-700"
          >
            {d}
          </button>
        ))}
        <button
          type="button"
          onClick={tapBackspace}
          className="min-h-14 rounded-lg bg-neutral-200 text-lg font-medium active:bg-neutral-300 dark:bg-neutral-700 dark:active:bg-neutral-600"
          aria-label="Backspace"
        >
          ⌫
        </button>
        <button
          type="button"
          onClick={() => tapDigit("0")}
          className="min-h-14 rounded-lg bg-neutral-100 text-xl font-medium active:bg-neutral-200 dark:bg-neutral-800 dark:active:bg-neutral-700"
        >
          0
        </button>
        <button
          type="button"
          onClick={tapClear}
          className="min-h-14 rounded-lg bg-neutral-200 text-sm font-medium active:bg-neutral-300 dark:bg-neutral-700 dark:active:bg-neutral-600"
        >
          Clear
        </button>
      </div>

      <div className={`grid gap-2 ${precision === 16 ? "grid-cols-4" : "grid-cols-4"}`}>
        {fractionOptions.map((sixteenths) => (
          <button
            key={sixteenths}
            type="button"
            onClick={() => tapFraction(sixteenths)}
            className={`min-h-11 rounded-lg text-sm font-medium tabular-nums ${
              frac === sixteenths
                ? "bg-blue-600 text-white"
                : "bg-neutral-50 text-neutral-700 active:bg-neutral-100 dark:bg-neutral-800/60 dark:text-neutral-300 dark:active:bg-neutral-700"
            }`}
          >
            {fractionLabel(sixteenths)}
          </button>
        ))}
      </div>
    </div>
  );
}
