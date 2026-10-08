import { Suspense } from "react";
import type { Metadata } from "next";
import { Tour } from "./tour";

export const metadata: Metadata = { title: "Tour · Measure" };

/**
 * The step-by-step tour. The tour reads ?step= (so a "?" link on a busy
 * screen can open it at the right place), and a client component reading the
 * URL has to sit inside a Suspense boundary for the page to stay prebuilt —
 * see node_modules/next/dist/docs/01-app/03-api-reference/04-functions/
 * use-search-params.md, "Prerendering".
 */
export default function TourPage() {
  return (
    <Suspense fallback={<main className="p-4 text-sm text-neutral-500">Loading…</main>}>
      <Tour />
    </Suspense>
  );
}
