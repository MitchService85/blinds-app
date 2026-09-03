"use client";

import type { ReactNode } from "react";
import { useKeyboardOpen } from "./keyboard";

interface BottomBarProps {
  children: ReactNode;
  /**
   * "solid": an opaque bar with a top rule — the screen's primary actions
   * (Save & exit + Export, Create job).
   * "floating": a single button riding over the content on a fade, for the
   * unit screen where the button is the last row of a long form and the list
   * continues beneath it.
   */
  variant?: "solid" | "floating";
}

/**
 * The one bottom bar. Every screen that had its own copy drifted a little
 * (three class strings, two safe-area treatments), and none of them handled
 * the keyboard — see components/keyboard.tsx for why that matters on iOS.
 *
 * Sticky in-flow, never fixed, with mt-auto so it sits at the bottom of a
 * short page too. Hidden entirely while a text control has focus: with the
 * keyboard up the bar would be behind it anyway, and an invisible bar cannot
 * be stranded mid-screen when the keyboard goes.
 */
export function BottomBar({ children, variant = "solid" }: BottomBarProps) {
  const keyboardOpen = useKeyboardOpen();
  const className =
    variant === "solid"
      ? "safe-bottom sticky bottom-0 z-30 -mx-4 mt-auto flex gap-3 border-t border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-950"
      : "sticky bottom-0 z-20 -mx-4 bg-gradient-to-t from-white via-white/95 to-transparent px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-5 dark:from-neutral-950 dark:via-neutral-950/95";
  return (
    <div hidden={keyboardOpen} className={className}>
      {children}
    </div>
  );
}
