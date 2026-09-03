"use client";

import { useEffect, useState } from "react";

/**
 * The on-screen keyboard, as far as a web page can know about it.
 *
 * iOS Safari (and the home-screen app even more so) never tells the page the
 * keyboard opened. What it does instead is the source of every "the bottom
 * button is floating / overlapping / jumped" report this app has had:
 *
 *   1. The layout viewport does NOT shrink. A bottom-anchored element — fixed
 *      OR sticky, it makes no difference — stays anchored to the layout
 *      bottom, which is now behind the keyboard.
 *   2. To reveal the caret, WebKit scrolls the document. For an input inside
 *      a `position: fixed` overlay that scroll is pointless, so it runs to
 *      the end of the page: the screen "jumps to the bottom" while typing.
 *   3. When the keyboard closes, the visual viewport is frequently left
 *      offset from the layout viewport until the next real scroll, so the
 *      bottom bar paints mid-screen over the content.
 *
 * The page cannot fix WebKit, but it can stop giving it the chance:
 *   - hide bottom bars while a text control has focus (nothing to strand,
 *     nothing to cover the field being typed in) — useKeyboardOpen;
 *   - never put a text control inside a fixed overlay (see the floor
 *     screen's note panel and the Money card's pricing form, both in-flow);
 *   - nudge the scroll position after every blur so the two viewports
 *     re-anchor — ViewportGuard.
 *
 * Focus, not visualViewport geometry, is the signal on purpose: the geometry
 * heuristic misreads iPads with hardware keyboards and split-screen, and it
 * fires late, after the keyboard has already animated in.
 */

const NON_TEXT_INPUT_TYPES = new Set([
  "button",
  "checkbox",
  "color",
  "file",
  "hidden",
  "image",
  "radio",
  "range",
  "reset",
  "submit",
]);

/** True for anything that raises the on-screen keyboard when focused. */
export function isTextEntry(el: EventTarget | null): el is HTMLElement {
  if (!(el instanceof HTMLElement)) return false;
  if (el instanceof HTMLTextAreaElement) return true;
  if (el instanceof HTMLInputElement) return !NON_TEXT_INPUT_TYPES.has(el.type);
  return el.isContentEditable;
}

/** Whether a text control currently has focus — i.e. the keyboard is up. */
export function useKeyboardOpen(): boolean {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onFocusIn = (e: FocusEvent) => {
      if (isTextEntry(e.target)) setOpen(true);
    };
    const onFocusOut = (e: FocusEvent) => {
      if (!isTextEntry(e.target)) return;
      // Tabbing straight from one field to the next keeps the keyboard up;
      // don't flash the bar in between.
      if (isTextEntry(e.relatedTarget)) return;
      setOpen(false);
    };
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", onFocusOut);
    // A field autofocused before this hook mounted has already fired its
    // focusin — read the live state once (external-system sync, not
    // derived state).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (isTextEntry(document.activeElement)) setOpen(true);
    return () => {
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", onFocusOut);
    };
  }, []);

  return open;
}

/**
 * Re-anchor the visual viewport after the keyboard closes (point 3 above).
 * A one-pixel scroll and back is a real scroll, which is what WebKit needs;
 * it runs twice because the keyboard's dismiss animation is ~250ms and the
 * offset can be introduced at either end of it. Mounted once, in the root
 * layout, so every screen gets it.
 */
export function ViewportGuard() {
  useEffect(() => {
    const nudge = () => {
      const y = window.scrollY;
      window.scrollTo(0, y + 1);
      requestAnimationFrame(() => window.scrollTo(0, y));
    };
    const onFocusOut = (e: FocusEvent) => {
      if (!isTextEntry(e.target) || isTextEntry(e.relatedTarget)) return;
      window.setTimeout(nudge, 100);
      window.setTimeout(nudge, 400);
    };
    document.addEventListener("focusout", onFocusOut);
    return () => document.removeEventListener("focusout", onFocusOut);
  }, []);
  return null;
}
