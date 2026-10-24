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
          <p>The room carries over from the window before — handy along one wall, risky when you walk into the next room. A carried-over room shows in <b>yellow</b> until you tap a room to confirm it.</p>
          <p>Need another room type? Add it on the job&apos;s page under <b>Room tags</b>.</p>
        </Topic>
        <Topic id="bays" title="Bay windows and deducts">
          <p>One frame holding two or three blinds is <b>one window</b>: enter the first width, tap <b className="whitespace-nowrap">+ panel</b>, enter the next. Each panel is one blind.</p>
          <p>Under the panels you&apos;ll see the <b>Total width</b> — every panel added up. Tape the whole wall and check it matches: side panels that are each a little short look fine one at a time and only show up in the total. A bay entered as separate windows (LR1 with deduct left, LR2, LR3 with deduct right) gets the same total, under its last window.</p>
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
        <Topic id="floor-settings" title="What do Drive R, Tight and Deduct ½ mean?">
          <p>The chips at the top of a floor are its settings, used for every window on it. Tap <b>Edit</b> to change them.</p>
          <ul className="flex list-disc flex-col gap-1 pl-5">
            <li><b>Drive L / R</b> — which end the drive sits on: the gear, or the spring clutch on models that have one. Not every blind has a control chain, but every one has a drive end.</li>
            <li><b>Tight / Finished</b> — how you measured: tight to the opening (the factory takes its deduction) or the finished blind size.</li>
            <li><b>Inside / Outside</b> — where the blind sits.</li>
            <li><b>Deduct ½</b> — the deduct amount. The factory sheet prints it as &ldquo;D = ½&rdquo;.</li>
            <li><b>Rev</b> — reverse roll. <b>Motorized</b> — the whole floor is motorized.</li>
            <li><b>Fabric color codes</b> — one per room type, printed in the sheet&apos;s header.</li>
          </ul>
          <p>Any one window can override these — see &ldquo;One window that&apos;s different&rdquo;.</p>
        </Topic>
        <Topic id="grid" title="Tile colours and the ⋯ menu">
          <p><b>Green</b> done, <b>yellow</b> in progress, <b>plain</b> not started, <b>struck through</b> skipped (N/A). The line under the number lists the rooms measured there.</p>
          <p>An <b>orange dot</b> in a tile&apos;s corner is a measurement to double-check — see the next topic. A <b>blue dot</b> means the unit has a note.</p>
          <p>Tap a tile to measure it. Tap its <b>⋯</b> (or press and hold) to <b>Mark done</b> or <b>Mark N/A</b>, add a note, or delete it.</p>
          <p>Install mode colours the same grid its own way — see &ldquo;Install mode&rdquo;.</p>
        </Topic>
        <Topic id="warnings" title="Measurement checks and “Looks right”">
          <p>An <b>orange dot</b> on a tile means a measurement looks unusual: a size way off, bay sides that don&apos;t match, or every blind in a unit tagged the same room.</p>
          <p>Tap the dot to see why — each line starts <b>Check:</b>. Open the unit and the check sits in grey, with a ruler, on the blind it&apos;s about.</p>
          <p>It&apos;s a question, not a deficiency, and it never blocks you. If the size is wrong, tap <b>Edit</b> on that blind. If it&apos;s really like that, tap <b>Looks right</b> — that clears it on every phone. <b>Turn checks back on</b> in the same spot brings it back.</p>
        </Topic>
        <Topic id="duplicates" title="Two phones made the same unit">
          <p>If two people add the same unit while apart, the floor shows a warning after syncing with a one-tap <b>Merge</b>. Nothing is lost: windows and photos from both end up on one unit, and repeated room tags renumber themselves.</p>
        </Topic>
      </Group>

      <Group title="Sending and installing">
        <Topic id="export" title="Exporting to the factory">
          <p>On a floor, tap <b>Export</b>. The blue <b>Export measure sheet</b> is the file the factory builds from. The <b>deficiency list</b> below it is only the blinds with a deficiency, for the PM — not for the factory.</p>
          <p>If anything changed since the last export, you&apos;ll see what before it builds. Tap &ldquo;Exported …&rdquo; to see past exports and download any of them again.</p>
          <p>It works with no signal — the file is made on the phone. Send it with your phone&apos;s share sheet.</p>
        </Topic>
        <Topic id="install" title="Install mode">
          <p>Flip a floor from <b>Measure</b> to <b>Install</b>. The top says what&apos;s left — &ldquo;9 of 12 still to do&rdquo; — then tap a unit. The top row of its sheet says how far it got:</p>
          <ul className="flex list-disc flex-col gap-1 pl-5">
            <li><b>Not started</b> — nothing there yet.</li>
            <li><b>Staged</b> — blinds and hardware dropped off, ready to go.</li>
            <li><b>Installed</b> — up and finished.</li>
          </ul>
          <p>Under it, what&apos;s stopping it:</p>
          <ul className="flex list-disc flex-col gap-1 pl-5">
            <li><b className="whitespace-nowrap">⚠ Blocked</b> — something stops the install. It asks why right there on the floor (&ldquo;painters still in BR&rdquo;). Tap <b>Unblock</b> when it clears.</li>
            <li><b className="whitespace-nowrap">🔒 Locked out</b> — couldn&apos;t get in. A PM with a share link sees it and arranges access.</li>
          </ul>
          <p>Tiles: <b>green</b> installed, <b>green outline</b> staged, <b>plain</b> not started, <b>strong yellow</b> blocked, <b>purple</b> locked out. A yellow tile says why: <b className="whitespace-nowrap">⚠ 2 to fix</b> (deficiencies for you), <b className="whitespace-nowrap">⚠ PM</b> (the PM&apos;s report), <b className="whitespace-nowrap">⚠ on hold</b> (blocked by hand). A plain tile reading <b className="whitespace-nowrap">⚠ 1 to check</b> isn&apos;t up yet but has a deficiency recorded — often the note for a blind still to go up.</p>
          <p>Once a unit is staged or installed, any open deficiency — yours or the PM&apos;s — shows it <b>blocked</b> until the last one is fixed. There&apos;s nothing to undo: fix the last one and it turns green.</p>
          <p>The unit&apos;s sheet lists what&apos;s open; <b>Open unit to fix</b> takes you there. Below the grid, <b>Still to fix on this floor</b> lists every one — tap a row to go straight to that blind.</p>
        </Topic>
        <Topic id="deficiencies" title="Recording and fixing deficiencies">
          <p>Something wrong with a blind? Open the unit and tap <b className="whitespace-nowrap">+ Deficiency</b> under that blind. Say what&apos;s wrong, whose error it was — <b>Factory error</b>, <b>Measure error</b> or <b>Not sure</b> — and tick <b>Needs recut</b> if it does. Then <b>Add deficiency</b>.</p>
          <p>Each deficiency is its own entry, in yellow under its blind. The line above the windows says where the unit stands: &ldquo;2 deficiencies to fix · 1 fixed&rdquo; — tap it to jump to the first.</p>
          <p>To fix one, tap <b className="whitespace-nowrap">Fix ›</b>. Pick what was done (the likely one is picked for you — <b>New blind installed</b> for a deduct, <b>Shimmed</b> for a shim) or type it, then <b className="whitespace-nowrap">✓ Mark fixed</b>. It stays listed in green as the record — &ldquo;✓ Fixed Oct 23 — Shimmed&rdquo;. <b className="whitespace-nowrap">Edit ›</b> on it changes what was done; <b>Not fixed after all</b> opens it again.</p>
          <p>Something new wrong with the same blind later? Tap <b className="whitespace-nowrap">+ Deficiency</b> again: it&apos;s a separate entry, fixed on its own. Entered one by mistake? <b className="whitespace-nowrap">Fix ›</b>, then <b>Change</b>, then <b>Remove (entered by mistake)</b>.</p>
          <p>A PM&apos;s deficiency carries a <b>PM · Anthony</b> chip and is fixed the same way — they see it as <b className="whitespace-nowrap">✓ Fixed</b>. One about the whole unit rather than a blind sits under <b>Deficiencies on the whole unit</b>.</p>
        </Topic>
        <Topic id="fixes" title="Deficiency batches: going back to fix">
          <p>Going back to fix a floor&apos;s worth? On the job&apos;s page, under <b>Deficiency batches</b>, tap <b className="whitespace-nowrap">+ Start a deficiency batch</b> and tick the floors you&apos;re fixing. Every open deficiency on them goes in the list, one line each — a blind with two is two.</p>
          <p>Work down it: pick or type what was done and tap <b className="whitespace-nowrap">✓ Fixed</b>. The card folds up, with <b>Change</b> and <b>Undo</b> if you need them, and the deficiency is marked fixed on the blind too. <b>Can&apos;t fix</b> keeps it open, with a reason — waiting on the factory, say.</p>
          <p><b className="whitespace-nowrap">Bill N fixes ↓</b> at the bottom takes you to <b>Bill these fixes</b>. Each blind bills as one fix per panel worked on — a bay fixed on both sides is 2. Set the <b>charge per fix</b> once; it bills everything fixed and not billed yet. Our own measure errors show <b>Our error — not charged</b>.</p>
        </Topic>
        <Topic id="pm" title="Sharing with a project manager">
          <p>On a job&apos;s page, open <b>Business</b>, then under <b>Project manager access</b> tap <b className="whitespace-nowrap">+ Give a PM access</b>. Fill in <b>Name the PM sees</b> — it heads their page and goes on every deficiency they send, so you see it as <b>PM · Anthony</b>. <b>Create link</b>, then <b>Share link</b>. <b>Revoke</b> cuts it off.</p>
          <p>Their page shows how many units are complete, and a tile per unit: <b>complete</b>, <b>not yet</b>, <b>no access</b> (locked out — theirs to arrange), <b>your report</b> (a deficiency they sent, now with you) or <b>return visit</b> (you&apos;re coming back, for a reason they don&apos;t see). <b>Needs your attention</b> at the top lists what&apos;s theirs.</p>
          <p>They can report a deficiency on a unit or a blind. When you mark it fixed, their page shows <b className="whitespace-nowrap">✓ Fixed</b>. They never see sizes, notes, reasons or prices.</p>
        </Topic>
      </Group>

      <Group title="Your account and the app">
        <Topic id="sync" title="Signing in and syncing">
          <p>Sign in once — it emails you a code — and your work shares with the rest of the crew.</p>
          <p>No signal is fine. The status at the top of the home screen shows <b>offline</b>, a number of changes <b>pending</b>, or <b className="whitespace-nowrap">✓ synced</b>. It catches up by itself; tap it for <b>Sync now</b>.</p>
        </Topic>
        <Topic id="money" title="Contract, invoices and site trips">
          <p>On a job&apos;s page, under <b>Business</b>: record the contract, log each site trip, and make an invoice from the blinds actually measured and installed. Your standard rates live in <b>Settings</b>.</p>
        </Topic>
        <Topic id="version" title="Which version am I on?">
          <p>At the bottom of <b>Settings</b>: &ldquo;Version v2.8 · Up to date&rdquo;. If it says a newer version is available, tap <b>Reload</b>. Mention the version when you report a problem.</p>
        </Topic>
        <Topic id="demo" title="The sample job">
          <p><b>Sample Building (demo)</b> is made up, for trying things. It only shows while you&apos;re signed out and never syncs anywhere.</p>
        </Topic>
      </Group>
    </main>
  );
}
