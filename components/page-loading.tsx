/**
 * The instant fallback for every dynamic screen (app/**\/loading.tsx).
 *
 * Its presence is what matters more than its content: a segment with a
 * loading file is partially prefetched, so a tap on a <Link> to it swaps the
 * screen immediately instead of waiting on the server. The text matches the
 * placeholder each page renders while it reads its own rows, so the two
 * loading states are indistinguishable and the transition reads as one.
 */
export function PageLoading() {
  return <main className="p-4 text-sm text-neutral-500">Loading…</main>;
}
