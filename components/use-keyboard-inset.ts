"use client";

import { useEffect, useState } from "react";

/**
 * Height in px of the on-screen keyboard's overlap with the layout viewport.
 *
 * iOS Safari does not shrink the layout viewport when the keyboard opens, so
 * a `fixed` bottom sheet stays anchored *behind* the keyboard: focusing its
 * textarea makes the page scroll to the bottom chasing the caret while the
 * caret stays hidden (field report, 2026-08-27 — "jumps down to the bottom
 * every time I start typing"). Callers pad their sheet up by this amount.
 *
 * Tracks window.visualViewport; 0 when the API is missing (older browsers,
 * SSR) or the keyboard is closed.
 */
export function useKeyboardInset(): number {
  const [inset, setInset] = useState(0);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () =>
      setInset(Math.max(0, window.innerHeight - vv.height - vv.offsetTop));
    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, []);

  return inset;
}
