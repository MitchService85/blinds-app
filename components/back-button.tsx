"use client";

import Link, { useLinkStatus } from "next/link";
import { useRouter } from "next/navigation";

/**
 * The back arrow, as a control that answers a finger.
 *
 * It used to be a bare "←" glyph on a button that called router.push() to a
 * dynamic route. Two things made it feel broken on a phone (field note,
 * 2026-09-16: "slow to respond, I'm often clicking it a few times … no
 * press state"):
 *
 *   1. router.push() never prefetches, and the dynamic routes it pointed at
 *      had no loading.tsx, so Next waited for the server's response before
 *      changing anything on screen. On cell data that is a long, silent gap.
 *   2. globals.css removes iOS's own tap highlight (rightly — it flashes the
 *      whole card), and nothing was put in its place. A tap changed nothing.
 *
 * So: a <Link>, which prefetches the destination while it sits in the
 * viewport and, with loading.tsx on every dynamic segment, transitions the
 * moment it is tapped; a 44px round hit area that visibly dips and tints
 * under the finger; and, for the rare navigation that still has to wait on
 * the network, the arrow dims after a beat so a delay reads as "working",
 * not "ignored".
 */
const CLASS =
  "flex h-11 w-11 shrink-0 select-none items-center justify-center rounded-full text-xl " +
  "[-webkit-touch-callout:none] transition-[background-color,scale] duration-100 ease-out " +
  "active:scale-90 active:bg-neutral-200 dark:active:bg-neutral-700";

/**
 * iOS Safari only applies :active on touch when a touchstart listener exists
 * on the element or an ancestor. An empty one is the documented workaround
 * and costs nothing; without it the press styles below never show on the
 * phone this app is built for.
 */
const noop = () => {};

export function BackButton({ href, label = "Back" }: { href: string; label?: string }) {
  return (
    <Link href={href} aria-label={label} className={CLASS} onTouchStart={noop} draggable={false}>
      <Arrow />
    </Link>
  );
}

/**
 * For screens reached from more than one place (Help, New job), where the
 * right destination is wherever you came from. History navigation is served
 * from the browser's own cache, so it has none of the delay above.
 */
export function BackHistoryButton({ label = "Back" }: { label?: string }) {
  const router = useRouter();
  return (
    <button
      type="button"
      onClick={() => router.back()}
      aria-label={label}
      className={CLASS}
      onTouchStart={noop}
    >
      <span aria-hidden>←</span>
    </button>
  );
}

function Arrow() {
  const { pending } = useLinkStatus();
  // Always rendered at full size; only opacity animates, and only after a
  // short delay (see .nav-pending), so a fast transition never flickers.
  return (
    <span aria-hidden className={pending ? "nav-pending" : undefined}>
      ←
    </span>
  );
}
