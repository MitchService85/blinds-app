"use client";

import Link from "next/link";
import { useEffect, useSyncExternalStore, type ReactNode } from "react";
import { BackHistoryButton } from "@/components/back-button";
import { Icon } from "@/components/icon";
import { TOUR_PROGRESS_KEY, TOUR_STEPS } from "@/lib/guide";
import { readPref } from "@/lib/local-pref";

/**
 * The guide: the tour up top for a first day, then short answers to look up.
 *
 * It replaced one long page (2026-10-08, "it feels overwhelming for a new
 * user") whose measuring section ran nine paragraphs and mixed day-one basics
 * with fabric codes and duplicate-unit merges — and had drifted: it still
 * described a width-to-height auto-flip the app no longer does. The basics
 * now live in the tour, where they can be tried; this page is reference, one
 * closed topic per question, each a few lines long. Screens link straight to
 * a topic with /help#id, which opens it.
 */

const subscribeNever = () => () => {};
const readProgress = () => readPref(TOUR_PROGRESS_KEY);
const noProgress = () => null;

function countDone(raw: string | null): number {
  try {
    const parsed: unknown = JSON.parse(raw ?? "[]");
    return Array.isArray(parsed) ? parsed.length : 0;
  } catch {
    return 0;
  }
}

function Topic({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <details id={id} className="group scroll-mt-24 rounded-xl border border-neutral-200 dark:border-neutral-800">
      <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 px-4 text-base font-medium [&::-webkit-details-marker]:hidden">
        {title}
        <span aria-hidden className="shrink-0 text-xs text-neutral-400 transition-transform group-open:rotate-180">
          ▾
        </span>
      </summary>
      <div className="flex flex-col gap-2 px-4 pb-4 text-sm leading-relaxed text-neutral-700 dark:text-neutral-300">
        {children}
      </div>
    </details>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="mt-2 text-sm font-semibold text-neutral-500">{title}</h2>
      {children}
    </section>
  );
}

export default function HelpPage() {
  const done = countDone(useSyncExternalStore(subscribeNever, readProgress, noProgress));
  const total = TOUR_STEPS.length;

  // /help#export opens that topic and brings it into view — the "?" links on
  // busy screens land on the answer, not at the top of a list.
  useEffect(() => {
    const open = () => {
      const el = document.getElementById(window.location.hash.slice(1));
      if (el instanceof HTMLDetailsElement) {
        el.open = true;
        el.scrollIntoView({ block: "start" });
      }
    };
    open();
    window.addEventListener("hashchange", open);
    return () => window.removeEventListener("hashchange", open);
  }, []);

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-3 p-4 pb-12">
      <header className="safe-sticky-top sticky z-20 -mx-4 flex items-center gap-3 bg-white/95 px-4 pb-3 backdrop-blur dark:bg-neutral-950/95">
        <BackHistoryButton />
        <h1 className="text-xl font-semibold">Guide</h1>
      </header>

      <Link
        href="/help/tour"
        className="flex items-center gap-4 rounded-2xl bg-blue-600 p-4 text-white active:bg-blue-700"
      >
        <span aria-hidden className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-white/20 text-2xl">
          {done >= total ? <Icon name="check" size={24} /> : "▶"}
        </span>
        <span className="flex-1">
          <span className="block text-lg font-semibold">
            {done === 0 ? "New here? Take the tour" : done >= total ? "Take the tour again" : "Continue the tour"}
          </span>
          <span className="block text-sm text-white/85">
            {done === 0
              ? `${total} short steps, about 5 minutes. You try each thing as you go.`
              : done >= total
                ? "All steps done."
                : `${done} of ${total} steps done.`}
          </span>
        </span>
      </Link>

      <Group title="Measuring">
        <Topic id="measuring" title="Measuring tips">
          <p>Pick the room, tap the whole inches, then the fraction. Tap <b>Height</b> when the width&apos;s in. Everything saves as you tap; <b>Save · next window</b> just moves you on.</p>
          <p><b>Height fills in for you</b> from the last window of the same room on that floor. Check it before you move on.</p>
          <p>Laser reads 1/16 or 1/32? Flip the <b>⅛ · ¹⁄₁₆ · ¹⁄₃₂</b> switch and type exactly what it says. The factory gets it rounded down to the eighth.</p>
          <p>Several identical blinds in one room? Enter one and set <b>Quantity</b> under <b>More options</b>.</p>
        </Topic>
        <Topic id="tags" title="Room tags (LR, BR, MBR, STU…)">
          <p>LR living room, BR bedroom, MBR master, K kitchen, <b>STU</b> studio or bachelor (one room that&apos;s also the bedroom).</p>
          <p>Two windows in the same room number themselves: LR1, LR2. Delete one and the rest renumber.</p>
          <p>The room carries over from the window before — handy along one wall, risky when you walk into the next room. A carried-over room shows in <b>amber</b> until you tap a room to confirm it.</p>
          <p>Need another room type? Add it on the job&apos;s page under <b>Room tags</b>.</p>
        </Topic>
        <Topic id="bays" title="Bay windows and deducts">
          <p>One frame holding two or three blinds is <b>one window</b>: enter the first width, tap <b>+ panel</b>, enter the next. Each panel is one blind.</p>
          <p>A deduct of <b>Both</b> trims only the outer edges — the left of the left blind (Dl) and the right of the right blind (Dr). Middle blinds are never trimmed.</p>
          <p>On a bay, each panel&apos;s drive side can differ: under <b>Control per panel</b>, tap a panel to switch it between the floor&apos;s default, L and R.</p>
        </Topic>
        <Topic id="window-options" title="One window that's different">
          <p>Open <b>More options</b> on that window to change just it: Measure (Tight / Finished), Mount (Inside / Outside), Motorized, Chain length, Quantity, or a Note.</p>
          <p>Each change shows as a small badge on the window in the list — <b>Fin</b>, <b>Out</b>, <b>M</b>, <b>LC</b> — so you can see what&apos;s different without opening it.</p>
        </Topic>
        <Topic id="notes" title="Notes and photos">
          <p>Every unit has a note at the top of its screen — shims, missing hardware, PRIORITY. Add a photo right there. The whole crew sees both.</p>
          <p>A unit with a note gets a blue badge on its tile. A floor&apos;s extra note — set in the floor&apos;s <b>Edit</b>, printed on every window — shows the same badge on that floor on the job&apos;s page.</p>
        </Topic>
      </Group>

      <Group title="Floors">
        <Topic id="floor-settings" title="What do Drive R, Tight and D=½ mean?">
          <p>The chips at the top of a floor are its settings, used for every window on it. Tap <b>Edit</b> to change them.</p>
          <ul className="flex list-disc flex-col gap-1 pl-5">
            <li><b>Drive L / R</b> — which end the drive sits on: the gear, or the spring clutch on models that have one. Not every blind has a control chain, but every one has a drive end.</li>
            <li><b>Tight / Finished</b> — how you measured: tight to the opening (the factory takes its deduction) or the finished blind size.</li>
            <li><b>Inside / Outside</b> — where the blind sits.</li>
            <li><b>D=½</b> — the deduct amount printed on the sheet.</li>
            <li><b>Rev</b> — reverse roll. <b>Motorized</b> — the whole floor is motorized.</li>
            <li><b>Fabric color codes</b> — one per room type, printed in the sheet&apos;s header.</li>
          </ul>
          <p>Any one window can override these — see &ldquo;One window that&apos;s different&rdquo;.</p>
        </Topic>
        <Topic id="grid" title="Tile colours and the ⋯ menu">
          <p><b>Green</b> done, <b>amber</b> started, <b>plain</b> not started, <b>struck through</b> skipped (N/A). The line under the number lists the rooms measured there.</p>
          <p>Tap a tile to measure it. Tap its <b>⋯</b> (or press and hold) to mark it done or N/A, add a note, or delete it.</p>
        </Topic>
        <Topic id="warnings" title="Orange warnings and “Looks right”">
          <p>An orange <b>⚠</b> means something looks unusual: a size way off, bay sides that don&apos;t match, or every blind in a unit tagged the same room.</p>
          <p>Tap the ⚠ on a tile to see why. Open the unit and the warning sits on the blind it&apos;s about.</p>
          <p>It never blocks you. If it&apos;s actually right, tap <b>Looks right</b> — that clears it on every phone. You can turn it back on from the same spot.</p>
        </Topic>
        <Topic id="duplicates" title="Two phones made the same unit">
          <p>If two people add the same unit while apart, the floor shows a warning after syncing with a one-tap <b>Merge</b>. Nothing is lost: windows and photos from both end up on one unit, and repeated room tags renumber themselves.</p>
        </Topic>
      </Group>

      <Group title="Sending and installing">
        <Topic id="export" title="Exporting to the factory">
          <p>On a floor, tap <b>Export</b>. The blue <b>Export measure sheet</b> is the file the factory builds from. The <b>deficiency list</b> below it is only the blinds flagged with a problem, for the PM — not for the factory.</p>
          <p>If anything changed since the last export, you&apos;ll see what before it builds. Tap &ldquo;Exported …&rdquo; to see past exports and download any of them again.</p>
          <p>It works with no signal — the file is made on the phone. Send it with your phone&apos;s share sheet.</p>
        </Topic>
        <Topic id="install" title="Install mode">
          <p>Flip a floor from <b>Measure</b> to <b>Install</b>, then tap a unit to mark it.</p>
          <ul className="flex list-disc flex-col gap-1 pl-5">
            <li><b>Staged</b> — blinds and hardware dropped off, ready to go.</li>
            <li><b>Installed</b> — done.</li>
            <li><b>Locked out</b> — couldn&apos;t get in. A PM with a share link sees it and arranges access.</li>
            <li><b>Blocked</b> — something is stopping the install. It opens the unit so you can say what.</li>
          </ul>
          <p>A single blind wrong? Open the unit and tap <b>⚠</b> on that window: say what&apos;s wrong, whose error it was (Factory or Measure), and whether it needs a recut.</p>
        </Topic>
        <Topic id="pm" title="Sharing with a project manager">
          <p>On a job&apos;s page, <b>Give a PM access</b> makes a link. They see which units are installed, locked out or need a revisit, and can flag a deficiency. They never see sizes, notes, reasons or prices.</p>
        </Topic>
      </Group>

      <Group title="Your account and the app">
        <Topic id="sync" title="Signing in and syncing">
          <p>Sign in once — it emails you a code — and your work shares with the rest of the crew.</p>
          <p>No signal is fine. The status at the top of the home screen shows <b>offline</b>, a number of changes <b>pending</b>, or <b>✓ synced</b>. It catches up by itself; tap it for <b>Sync now</b>.</p>
        </Topic>
        <Topic id="money" title="Contract, invoices and site trips">
          <p>On a job&apos;s page: record the contract, log each site trip, and make an invoice from the blinds actually measured and installed. Your standard rates live in <b>Settings</b>.</p>
        </Topic>
        <Topic id="version" title="Which version am I on?">
          <p>At the bottom of <b>Settings</b>: &ldquo;Version v1.4 · Up to date&rdquo;. If it says a newer version is available, tap <b>Reload</b>. Mention the version when you report a problem.</p>
        </Topic>
        <Topic id="demo" title="The sample job">
          <p><b>Sample Building (demo)</b> is made up, for trying things. It only shows while you&apos;re signed out and never syncs anywhere.</p>
        </Topic>
      </Group>
    </main>
  );
}
