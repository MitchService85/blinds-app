"use client";

import { Icon } from "@/components/icon";
import { windowBadges, type BadgeTone } from "@/lib/window-badges";
import type { FloorDefaults } from "@/lib/types";

/**
 * One class string per tone. The four that existed before (deduct, control,
 * motor, chain) keep exactly the colours they had, so nothing a crew already
 * reads at a glance changes meaning; the new ones borrow the same weights.
 */
const TONE_CLASS: Record<BadgeTone, string> = {
  deduct: "bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300",
  control: "bg-purple-50 text-purple-700 dark:bg-purple-950 dark:text-purple-300",
  motor: "bg-emerald-600 text-white",
  "motor-off": "bg-neutral-200 text-neutral-600 line-through decoration-2 dark:bg-neutral-700 dark:text-neutral-300",
  convention: "bg-indigo-50 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300",
  chain: "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300",
  note: "bg-blue-500 text-white",
};

/**
 * The badge row for one window. Wraps rather than scrolls: a bay with a
 * deduct, per-panel controls, a finished measure and a note runs past 390px,
 * and a badge you have to scroll to find is a badge you don't see.
 */
export function WindowBadges({
  window: w,
  defaults,
}: {
  window: Parameters<typeof windowBadges>[0];
  defaults?: FloorDefaults;
}) {
  const badges = windowBadges(w, defaults);
  if (badges.length === 0) return null;
  return (
    <>
      {badges.map((b) => (
        <span
          key={b.key}
          title={b.title}
          aria-label={b.title}
          data-badge={b.key}
          className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold ${TONE_CLASS[b.tone]} ${
            b.icon ? "flex h-[18px] w-[18px] items-center justify-center rounded-full px-0" : ""
          }`}
        >
          {b.icon ? <Icon name="note" size={11} /> : b.label}
        </span>
      ))}
    </>
  );
}
