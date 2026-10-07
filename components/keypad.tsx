"use client";

import { useEffect, useState } from "react";
import {
  floorToEighth,
  formatFraction,
  formatThirtySeconds,
  thirtySecondsToStoredSixteenths,
} from "@/lib/fractions";
import { readPref, writePref } from "@/lib/local-pref";

export type Precision = 8 | 16 | 32;

const PRECISION_STORAGE_KEY = "measure:precision";
const MAX_WHOLE_DIGITS = 3;

/**
 * Precision switch (⅛ / ¹⁄₁₆ / ¹⁄₃₂), persisted per device (see spec: Window
 * entry). Per device because it follows the laser in that person's hand —
 * Mike's reads 32nds.
 */
export function usePrecision(): [Precision, (p: Precision) => void] {
  const [precision, setPrecisionState] = useState<Precision>(8);

  useEffect(() => {
    const stored = readPref(PRECISION_STORAGE_KEY);
    // One-time sync from an external store (localStorage) on mount, guarded
    // to client-only so the server-rendered/hydration-time default (8) never
    // mismatches — not a props/state mirroring anti-pattern.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (stored === "16" || stored === "32") setPrecisionState(Number(stored) as Precision);
  }, []);

  const setPrecision = (p: Precision) => {
    setPrecisionState(p);
    writePref(PRECISION_STORAGE_KEY, String(p));
  };

  return [precision, setPrecision];
}

// Every option is held in THIRTY-SECONDS, the finest the pad offers, so one
// number means the same thing whichever switch is on.
const EIGHTHS = [0, 4, 8, 12, 16, 20, 24, 28];
const SIXTEENTHS = Array.from({ length: 16 }, (_, i) => i * 2);
const THIRTY_SECONDS = Array.from({ length: 32 }, (_, i) => i);

const FRACTION_OPTIONS: Record<Precision, number[]> = {
  8: EIGHTHS,
  16: SIXTEENTHS,
  32: THIRTY_SECONDS,
};

const PRECISION_WORDS: Record<Precision, string> = {
  8: "an eighth",
  16: "a sixteenth",
  32: "a thirty-second",
};

const PRECISION_LABEL: Record<Precision, string> = {
  8: "⅛",
  16: "¹⁄₁₆",
  32: "¹⁄₃₂",
};

function fractionLabel(thirtySeconds: number): string {
  if (thirtySeconds === 0) return "0";
  return formatThirtySeconds(thirtySeconds);
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
  // In thirty-seconds; a stored sixteenth is two of them.
  const [frac, setFrac] = useState(() => (valueSixteenths % 16) * 2);
  // True until the first digit is tapped. The buffer still holds the seeded
  // value (e.g. the sticky height prefill of 87) — the first digit should
  // REPLACE that, not append to it, or "87" + tap 6 + tap 3 yields 876.
  const [pristine, setPristine] = useState(true);

  const commit = (nextWhole: string, nextFrac: number) => {
    const wholeNum = nextWhole === "" ? 0 : parseInt(nextWhole, 10);
    // Stored in sixteenths, so an odd 32nd floors to the sixteenth below.
    // The eighth the factory receives is identical either way — see
    // thirtySecondsToStoredSixteenths.
    onChange(wholeNum * 16 + thirtySecondsToStoredSixteenths(nextFrac));
  };

  const tapDigit = (d: string) => {
    const base = pristine || whole === "0" ? "" : whole;
    const next = base + d;
    if (next.replace(/^0+/, "").length > MAX_WHOLE_DIGITS) return;
    // The first digit replaces the seeded value INCLUDING its fraction: a
    // carried-over height of 84 1/2 must not leak its 1/2 under a freshly
    // typed 96 (the same failure addPanel's field note records for widths).
    // Tapping a fraction first still keeps the seeded whole — adjusting
    // just the fraction of a prefill stays one tap.
    const nextFrac = pristine ? 0 : frac;
    if (pristine) setFrac(0);
    setPristine(false);
    setWhole(next);
    commit(next, nextFrac);
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

  const wholeNum = whole === "" ? 0 : parseInt(whole, 10);
  // What was tapped, in 32nds, and the eighth it becomes on the sheet.
  const tapped = wholeNum * 32 + frac;
  const displaySixteenths = floorToEighth(wholeNum * 16 + thirtySecondsToStoredSixteenths(frac));
  const hasHint = tapped !== displaySixteenths * 2;
  const fractionOptions = FRACTION_OPTIONS[precision];

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
              from {formatThirtySeconds(tapped)}
            </div>
          )}
        </div>
        <div className="flex overflow-hidden rounded-lg border border-neutral-300 dark:border-neutral-700">
          {([8, 16, 32] as Precision[]).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => onPrecisionChange(p)}
              className={`min-h-11 min-w-11 px-2.5 text-sm font-medium ${
                precision === p
                  ? "bg-blue-600 text-white"
                  : "bg-white text-neutral-600 dark:bg-neutral-900 dark:text-neutral-300"
              }`}
              aria-pressed={precision === p}
              aria-label={`Measure to ${PRECISION_WORDS[p]}`}
            >
              {PRECISION_LABEL[p]}
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
            className="min-h-12 rounded-lg bg-neutral-100 text-xl font-medium active:bg-neutral-200 dark:bg-neutral-800 dark:active:bg-neutral-700"
          >
            {d}
          </button>
        ))}
        <button
          type="button"
          onClick={tapBackspace}
          className="min-h-12 rounded-lg bg-neutral-200 text-lg font-medium active:bg-neutral-300 dark:bg-neutral-700 dark:active:bg-neutral-600"
          aria-label="Backspace"
        >
          ⌫
        </button>
        <button
          type="button"
          onClick={() => tapDigit("0")}
          className="min-h-12 rounded-lg bg-neutral-100 text-xl font-medium active:bg-neutral-200 dark:bg-neutral-800 dark:active:bg-neutral-700"
        >
          0
        </button>
        <button
          type="button"
          onClick={tapClear}
          className="min-h-12 rounded-lg bg-neutral-200 text-sm font-medium active:bg-neutral-300 dark:bg-neutral-700 dark:active:bg-neutral-600"
        >
          Clear
        </button>
      </div>

      {/* Four across at every precision: a 32nd pad runs eight rows rather
          than shrinking the targets of a glove-width tap, and the Save bar is
          fixed to the screen so the extra rows never push it out of reach. */}
      <div className="grid grid-cols-4 gap-2">
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
