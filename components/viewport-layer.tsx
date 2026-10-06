"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * How far an overlay's bottom edge may sit from the viewport's before we stop
 * believing `position: fixed`. The real failure misses by hundreds of pixels;
 * this only has to clear rounding and any momentary offset while a URL bar
 * collapses, so it is set well above either.
 */
const PIN_TOLERANCE_PX = 24;

/** Readings needed before giving up on floating. See `pinned` below. */
const PIN_STRIKES = 2;

interface ViewportPinnedProps {
  /** Classes while the element really is pinned to the viewport. */
  pinnedClassName: string;
  /** Classes once it has given up and rejoined the page flow. */
  flowClassName: string;
  hidden?: boolean;
  /**
   * Called after every measurement with the element's height and whether it
   * is still pinned — for callers that reserve its space in the flow.
   */
  onLayout?: (height: number, pinned: boolean) => void;
  children: ReactNode;
}

/**
 * An element pinned to the bottom of the screen — the one bottom bar, the
 * dashboard's + New — rendered OUTSIDE the page's content.
 *
 * `position: fixed` is only relative to the viewport while no ancestor
 * captures it. A transform, a filter, `contain`, or a non-visible `overflow`
 * makes that ancestor the containing block instead, and then `bottom: 0`
 * means the bottom of THAT BOX, which is somewhere in the middle of a long
 * page. This is what stranded the Done/Export bar across a floor grid and
 * the + New button across the dashboard, reported from site three times
 * (2026-09-28 .. 2026-10-06), never once reproducible on a desktop browser.
 *
 * So these elements are portalled to <body>, out of <main> and out of every
 * wrapper a page might grow. <body> itself is kept free of anything that
 * could capture them — in particular the horizontal-overflow clip lives on
 * <main> now, not on <body>; see globals.css, and do not move it back.
 *
 * Belt and braces, because no WebKit engine is available to test against
 * here and two confident fixes before this one were wrong: after layout the
 * element measures whether its own bottom edge really is the bottom of the
 * screen, and if it is not — for any reason, including one not thought of —
 * it stops floating and rejoins the flow at the end of the page. Floating is
 * the nicety; not covering the last unit on the floor is the part that costs
 * money, so that is the half that degrades last. An overlay that scrolls
 * with the page is therefore also a bug report: it means this check fired.
 */
export function ViewportPinned({
  pinnedClassName,
  flowClassName,
  hidden = false,
  onLayout,
  children,
}: ViewportPinnedProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [host, setHost] = useState<HTMLElement | null>(null);
  /**
   * Latches false and stays there for the life of the screen. Flipping back
   * and forth as the page scrolls would be worse than either state, and an
   * engine that mis-anchors `fixed` once will do it again.
   */
  const [pinned, setPinned] = useState(true);

  // Portalled only after mount: document.body does not exist while the page
  // is being rendered on the server.
  useEffect(() => setHost(document.body), []);

  const layoutRef = useRef(onLayout);
  layoutRef.current = onLayout;

  // Measured, not hard-coded: these bars differ (one button, two, plus the
  // export status line) and the safe-area inset differs per device and per
  // orientation. A guessed constant is how content ends up underneath.
  useEffect(() => {
    const el = ref.current;
    if (!el || hidden) return;
    const measure = () => layoutRef.current?.(el.getBoundingClientRect().height, pinned);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [hidden, pinned, host]);

  useEffect(() => {
    if (!pinned || hidden || !host) return;
    let strikes = 0;
    let last = 0;
    let baseline: number | null = null;

    const check = () => {
      const el = ref.current;
      if (!el) return;
      // A correctly fixed element's bottom edge keeps the same distance from
      // the bottom of the layout viewport at every scroll position. One
      // anchored to a box inside the document tracks the document instead,
      // so it reads far below the fold near the top of a long page and far
      // above it further down — either way, off by much more than the
      // tolerance. (The offset below is compared against the FIRST reading
      // rather than against zero, since an overlay may legitimately sit a
      // little above the bottom edge — + New is inset by 20px.)
      const offset = window.innerHeight - el.getBoundingClientRect().bottom;
      if (baseline === null) {
        baseline = offset;
        return;
      }
      if (Math.abs(offset - baseline) <= PIN_TOLERANCE_PX) {
        strikes = 0;
        return;
      }
      if (++strikes >= PIN_STRIKES) setPinned(false);
    };

    // Readings at more than one scroll position: an element anchored to the
    // document happens to line up with the viewport at one particular
    // offset, which a single reading cannot tell apart from a correct one.
    const onScroll = () => {
      const now = Date.now();
      if (now - last < 200) return;
      last = now;
      check();
    };

    const first = requestAnimationFrame(check);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(first);
      window.removeEventListener("scroll", onScroll);
    };
  }, [pinned, hidden, host]);

  const node = (
    <div
      ref={ref}
      hidden={hidden}
      data-pinned={pinned}
      className={pinned ? pinnedClassName : flowClassName}
    >
      {children}
    </div>
  );

  if (!pinned) return node;
  // Nothing to portal into until mount. Rendering the element in place for
  // one frame instead would put it back inside the subtree this exists to
  // escape, and show it jumping.
  if (!host) return null;
  return createPortal(node, host);
}
