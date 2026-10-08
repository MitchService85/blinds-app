"use client";

import Link from "next/link";
import { useState, type ComponentType } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { BackHistoryButton } from "@/components/back-button";
import { BottomBar } from "@/components/bottom-bar";
import { Icon } from "@/components/icon";
import {
  BayDemo,
  ExportDemo,
  GridDemo,
  InstallDemo,
  JobsDemo,
  MeasureDemo,
  OfflineDemo,
  WarningDemo,
  type DemoProps,
} from "@/components/guide/demos";
import { TOUR_PROGRESS_KEY, TOUR_STEPS, type TourStepId } from "@/lib/guide";
import { readPref, writePref } from "@/lib/local-pref";

interface StepContent {
  intro: string;
  Demo: ComponentType<DemoProps>;
  /** Where to read more in the guide's reference. */
  more?: string;
}

/**
 * What each step says and lets you try. Kept to a sentence or two: the demo
 * is the lesson, the words only point at it. Anything longer belongs in the
 * reference topics on /help, which each step links to.
 */
const CONTENT: Record<TourStepId, StepContent> = {
  jobs: {
    intro: "Each job — a building — is a card on your home screen. Its floors (or batches) are inside it.",
    Demo: JobsDemo,
  },
  grid: {
    intro: "A floor is a grid of units. The colour of each one tells you where it stands.",
    Demo: GridDemo,
  },
  measure: {
    intro:
      "Pick the room, then tap in the width and the height. Everything saves as you tap — there's no Save to forget.",
    Demo: MeasureDemo,
    more: "measuring",
  },
  bays: {
    intro: "Some window frames hold two or three blinds side by side. Those are still one window.",
    Demo: BayDemo,
    more: "bays",
  },
  warnings: {
    intro: "The app keeps an eye out for numbers that look off and room tags that don't add up.",
    Demo: WarningDemo,
    more: "warnings",
  },
  export: {
    intro: "When a floor is measured, Export builds the factory's spreadsheet right on your phone.",
    Demo: ExportDemo,
    more: "export",
  },
  install: {
    intro: "On install day, the same floor becomes your checklist.",
    Demo: InstallDemo,
    more: "install",
  },
  offline: {
    intro: "Basements, elevators, parking garages — the app works with no signal and never loses anything.",
    Demo: OfflineDemo,
    more: "sync",
  },
};

function readDone(): Set<TourStepId> {
  try {
    const parsed: unknown = JSON.parse(readPref(TOUR_PROGRESS_KEY) ?? "[]");
    return new Set(Array.isArray(parsed) ? (parsed.filter((x) => typeof x === "string") as TourStepId[]) : []);
  } catch {
    return new Set();
  }
}

export function Tour() {
  const router = useRouter();
  const params = useSearchParams();
  const initial = TOUR_STEPS.findIndex((s) => s.id === params.get("step"));
  const [index, setIndex] = useState(initial >= 0 ? initial : 0);
  const [finished, setFinished] = useState(false);
  // Client-only subtree (it reads the URL), so local storage is safe to read here.
  const [done, setDone] = useState<Set<TourStepId>>(readDone);

  const step = TOUR_STEPS[index];
  const { intro, Demo, more } = CONTENT[step.id];
  const last = index === TOUR_STEPS.length - 1;

  function go(next: number) {
    setIndex(next);
    setFinished(false);
    // Keep the address in step, so a refresh or a shared link lands here.
    router.replace(`/help/tour?step=${TOUR_STEPS[next].id}`, { scroll: false });
    window.scrollTo({ top: 0 });
  }

  function markDone(id: TourStepId) {
    setDone((prev) => {
      if (prev.has(id)) return prev;
      const next = new Set(prev).add(id);
      writePref(TOUR_PROGRESS_KEY, JSON.stringify([...next]));
      return next;
    });
  }

  if (finished) {
    return (
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-5 p-4 pb-12">
        <header className="flex items-center gap-3">
          <BackHistoryButton label="Close the tour" fallbackHref="/help" />
          <h1 className="text-xl font-semibold">That&apos;s the basics</h1>
        </header>
        <div className="rounded-xl border border-emerald-300 bg-emerald-50 p-4 text-sm text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">
          <div className="mb-1 flex items-center gap-2 font-semibold">
            <Icon name="check-circle" size={18} /> You&apos;ve done all {TOUR_STEPS.length} steps.
          </div>
          Anything else — floor settings, fabric codes, invoices — is in the guide, one tap from the home
          screen.
        </div>
        <div className="flex flex-col gap-2">
          <Link href="/project/demo-project-0001" className="flex min-h-12 items-center justify-center rounded-xl bg-blue-600 font-semibold text-white">
            Try it on the sample job
          </Link>
          <Link href="/help" className="flex min-h-12 items-center justify-center rounded-xl border border-neutral-300 font-semibold dark:border-neutral-700">
            Open the guide
          </Link>
          <Link href="/" className="flex min-h-12 items-center justify-center rounded-xl font-medium text-neutral-600 dark:text-neutral-300">
            Back to my jobs
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-4 p-4">
      <header className="flex items-center gap-3">
        <BackHistoryButton label="Close the tour" fallbackHref="/help" />
        <div className="min-w-0 flex-1">
          <div className="text-xs font-medium text-neutral-500">
            Step {index + 1} of {TOUR_STEPS.length}
          </div>
          <h1 className="text-xl font-semibold">{step.title}</h1>
        </div>
      </header>

      {/* Progress: every step is a dot you can jump to; finished ones tick. */}
      <nav aria-label="Tour steps" className="flex gap-1.5">
        {TOUR_STEPS.map((s, i) => (
          <button
            key={s.id}
            type="button"
            onClick={() => go(i)}
            aria-label={`Step ${i + 1}: ${s.title}${done.has(s.id) ? " (done)" : ""}`}
            aria-current={i === index ? "step" : undefined}
            className={`h-2 flex-1 rounded-full ${
              i === index
                ? "bg-blue-600"
                : done.has(s.id)
                  ? "bg-emerald-500"
                  : "bg-neutral-200 dark:bg-neutral-800"
            }`}
          />
        ))}
      </nav>

      <p className="text-base leading-relaxed text-neutral-700 dark:text-neutral-300">{intro}</p>

      <section aria-label="Try it" className="rounded-2xl border border-neutral-200 p-4 dark:border-neutral-800">
        <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-neutral-500">Try it</div>
        {/* Keyed so a revisited step starts fresh rather than half-done. */}
        <Demo key={step.id} onDone={() => markDone(step.id)} />
      </section>

      {more && (
        <Link href={`/help#${more}`} className="self-start text-sm text-blue-600 underline-offset-2 hover:underline dark:text-blue-400">
          More about this in the guide →
        </Link>
      )}

      <BottomBar>
        <button
          type="button"
          onClick={() => go(index - 1)}
          disabled={index === 0}
          className="min-h-14 rounded-xl border border-neutral-300 px-5 text-base font-semibold disabled:opacity-40 dark:border-neutral-700"
        >
          Back
        </button>
        <button
          type="button"
          onClick={() => (last ? setFinished(true) : go(index + 1))}
          className="min-h-14 flex-1 rounded-xl bg-blue-600 text-base font-semibold text-white active:bg-blue-700"
        >
          {last ? "Finish" : done.has(step.id) ? "Next ✓" : "Next"}
        </button>
      </BottomBar>
    </main>
  );
}
