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
 * How far the bar's bottom edge may sit from the viewport's before we stop
 * believing `position: fixed`. The real failure misses by hundreds of pixels;
 * this only has to clear rounding and any momentary offset while a URL bar
 * collapses, so it is set well above either.
 */
const PIN_TOLERANCE_PX = 24;

/** Confirmations needed before giving up on floating. See `pinned` below. */
const PIN_STRIKES = 2;

/**
 * The one bottom bar. Every screen that had its own copy drifted a little
 * (three class strings, two safe-area treatments), and none of them handled
 * the keyboard — see components/keyboard.tsx for why that matters on iOS.
 *
 * FIXED to the viewport, with an in-flow spacer of exactly its own height
 * standing where it used to sit, so nothing is ever hidden underneath: the
 * page always ends with as much room as the bar occupies, measured rather
 * than guessed, so a bar that grows (a second line, a taller safe-area
 * inset) takes its padding with it.
 *
 * It was sticky-in-flow until 2026-10-05 and plain fixed until 2026-10-06,
 * and both landed the bar in the MIDDLE of a long floor grid on the crew's
 * iPhones, tiles spilling out behind and below it — the reason the last
 * blind in a unit could not be reached. The cause is in globals.css: every
 * <main> is `flex: 1 1 0%`, and a zero flex-basis keeps the content height
 * out of <body>'s height, so WebKit leaves <main> one viewport tall and
 * lets the grid overflow it. Fixed there, with the reasoning written down.
 *
 * This component does not take that on trust, because no WebKit engine is
 * available to test against here and two previous fixes read as correct and
 * were not. After layout it checks that its own bottom edge really is the
 * bottom of the screen, and if it is not — whatever the reason: a clipped
 * <body> capturing the fixed positioning, a transformed ancestor, something
 * not thought of — it stops floating and sits in the flow at the end of the
 * page instead. Floating is the nicety; not covering the last unit on the
 * floor is the part that costs money, so that is the half that degrades
 * last. A bar that scrolls with the page is therefore also a bug REPORT:
 * it means the check fired.
 *
 * Still hidden entirely while a text control has focus — which is also what
 * makes `fixed` safe here, since an iOS keyboard cannot strand a bar that
 * isn't rendered.
 */
export function BottomBar({ children, variant = "solid" }: BottomBarProps) {
  const keyboardOpen = useKeyboardOpen();
  const barRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(0);
  /**
   * Latches false and stays there for the life of the screen. Flipping back
   * and forth as the page scrolls would be worse than either state, and a
   * browser that mis-anchors `fixed` once will do it again.
   */
  const [pinned, setPinned] = useState(true);

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

  useEffect(() => {
    if (!pinned || keyboardOpen) return;
    let strikes = 0;
    let last = 0;

    const check = () => {
      const el = barRef.current;
      if (!el) return;
      // A correctly fixed bar's bottom edge is the bottom of the layout
      // viewport at every scroll position. One anchored to <body> instead
      // tracks the document, so it reads far below the fold near the top of
      // a long page and far above it further down — either way, off by much
      // more than the tolerance.
      const off = Math.abs(window.innerHeight - el.getBoundingClientRect().bottom);
      if (off <= PIN_TOLERANCE_PX) {
        strikes = 0;
        return;
      }
      if (++strikes >= PIN_STRIKES) setPinned(false);
    };

    // Two readings, at different scroll positions where possible: a bar
    // anchored to the document happens to line up with the viewport at the
    // very bottom of the page, which is exactly where a one-shot check would
    // be taken after following a link to a short screen.
    const onScroll = () => {
      const now = Date.now();
      if (now - last < 250) return;
      last = now;
      check();
    };

    const first = requestAnimationFrame(check);
    const second = window.setTimeout(check, 400);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(first);
      clearTimeout(second);
      window.removeEventListener("scroll", onScroll);
    };
  }, [pinned, keyboardOpen, height]);

  const solid =
    "flex flex-wrap gap-x-3 gap-y-1.5 border-t border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-950";
  const floating =
    "bg-gradient-to-t from-white via-white/95 to-transparent px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-5 dark:from-neutral-950 dark:via-neutral-950/95";

  // In the flow the bar is the page's last row, so it needs no safe-area
  // padding of its own on the solid variant (the page's own bottom padding
  // and mt-auto place it) — but it does still need to clear the home
  // indicator, hence safe-bottom either way.
  const position = pinned
    ? variant === "solid"
      ? "fixed inset-x-0 bottom-0 z-30"
      : "fixed inset-x-0 bottom-0 z-20"
    : "mt-auto -mx-4 shrink-0";

  const className = `${position} ${variant === "solid" ? `safe-bottom ${solid}` : floating}`;

  return (
    <>
      {/* Holds the bar's place in the flow while it floats. mt-auto keeps a
          short page's bar at the bottom of the screen, as the in-flow bar
          used to. Not rendered once the bar itself is back in the flow. */}
      {pinned && (
        <div
          aria-hidden
          className="mt-auto shrink-0"
          style={{ height: keyboardOpen ? 0 : height }}
        />
      )}
      <div ref={barRef} hidden={keyboardOpen} data-pinned={pinned} className={className}>
        {children}
      </div>
    </>
  );
}
