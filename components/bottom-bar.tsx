"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
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
 * FIXED to the viewport, with an in-flow spacer of exactly its own height
 * standing where it used to sit. It was sticky-in-flow until 2026-10-05,
 * which is a nicer idea and does not survive contact with WebKit: the page
 * is a column flex (`body { min-height:100%; display:flex }`) whose `main`
 * is `flex:1 1 0%`, and WebKit does not reliably grow that item past one
 * viewport. `main` gets clamped to the screen, a long unit grid overflows
 * it, and a sticky bar anchored to the bottom of `main` lands in the MIDDLE
 * of the page with tiles spilling out below and behind it — reported from
 * site repeatedly, and the reason the last blind in a unit could not be
 * reached. Chromium grows the item correctly, which is why it never
 * reproduced on a desktop browser.
 *
 * Fixed positioning cannot be stranded by that, and the spacer means
 * nothing is ever hidden underneath: the page always ends with exactly as
 * much room as the bar occupies, measured rather than guessed, so a bar that
 * grows (a second line, a taller safe-area inset) takes its padding with it.
 *
 * Still hidden entirely while a text control has focus — which is also what
 * makes `fixed` safe here, since an iOS keyboard cannot strand a bar that
 * isn't rendered.
 */
export function BottomBar({ children, variant = "solid" }: BottomBarProps) {
  const keyboardOpen = useKeyboardOpen();
  const barRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(0);

  // Measured, not hard-coded: the bars differ (one button, two, plus the
  // export status line) and the safe-area inset differs per device and per
  // orientation. A guessed constant is how content ends up under the bar.
  useEffect(() => {
    const el = barRef.current;
    if (!el) return;
    const measure = () => setHeight(el.getBoundingClientRect().height);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [keyboardOpen]);

  const className =
    variant === "solid"
      ? "safe-bottom fixed inset-x-0 bottom-0 z-30 flex flex-wrap gap-x-3 gap-y-1.5 border-t border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-950"
      : "fixed inset-x-0 bottom-0 z-20 bg-gradient-to-t from-white via-white/95 to-transparent px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-5 dark:from-neutral-950 dark:via-neutral-950/95";

  return (
    <>
      {/* Holds the bar's place in the flow. mt-auto keeps a short page's bar
          at the bottom of the screen, as the in-flow bar used to. */}
      <div aria-hidden className="mt-auto shrink-0" style={{ height: keyboardOpen ? 0 : height }} />
      <div ref={barRef} hidden={keyboardOpen} className={className}>
        {children}
      </div>
    </>
  );
}
