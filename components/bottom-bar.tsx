"use client";

import { useState, type ReactNode } from "react";
import { useKeyboardOpen } from "./keyboard";
import { ViewportPinned } from "./viewport-layer";

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
 * Pinned to the viewport by components/viewport-layer.tsx, which is where
 * the hard-won part lives: why it is portalled out of the page, and what it
 * does when the browser mis-anchors it anyway. Here there is only the
 * spacer — an in-flow block of exactly the bar's own height, standing where
 * the bar used to sit, so nothing is ever hidden underneath it. The page
 * always ends with as much room as the bar occupies, measured rather than
 * guessed, so a bar that grows (a second line, a taller safe-area inset)
 * takes its padding with it.
 *
 * Hidden entirely while a text control has focus — which is also what makes
 * floating safe here, since an iOS keyboard cannot strand a bar that isn't
 * rendered.
 */
export function BottomBar({ children, variant = "solid" }: BottomBarProps) {
  const keyboardOpen = useKeyboardOpen();
  const [height, setHeight] = useState(0);
  const [pinned, setPinned] = useState(true);

  const solid =
    "safe-bottom flex flex-wrap gap-x-3 gap-y-1.5 border-t border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-950";
  // In the flow the fade has nothing to fade over, so the floating variant
  // falls back to the solid treatment rather than to transparent buttons on
  // top of a unit list.
  const floating =
    "bg-gradient-to-t from-white via-white/95 to-transparent px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-5 dark:from-neutral-950 dark:via-neutral-950/95";

  return (
    <>
      {/* Holds the bar's place in the flow while it floats. mt-auto keeps a
          short page's bar at the bottom of the screen, as the in-flow bar
          used to. Not needed once the bar itself is back in the flow. */}
      {pinned && (
        <div
          aria-hidden
          className="mt-auto shrink-0"
          style={{ height: keyboardOpen ? 0 : height }}
        />
      )}
      <ViewportPinned
        hidden={keyboardOpen}
        onLayout={(h, isPinned) => {
          setHeight(h);
          setPinned(isPinned);
        }}
        pinnedClassName={`fixed inset-x-0 bottom-0 ${variant === "solid" ? "z-30" : "z-20"} ${
          variant === "solid" ? solid : floating
        }`}
        // -mx-4 cancels the page's own padding so the bar still runs edge to
        // edge, with its top rule spanning the screen, once it is in flow.
        flowClassName={`mt-auto -mx-4 shrink-0 ${solid}`}
      >
        {children}
      </ViewportPinned>
    </>
  );
}
