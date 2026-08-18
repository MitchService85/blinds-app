"use client";

import { useRouter } from "next/navigation";
import type { ReactNode } from "react";

/**
 * Contractor-facing instructions ("?" on the dashboard). Written for a
 * first-day user on a job site: short sentences, every section anchored by a
 * small visual. The visuals are drawn with the app's own styles instead of
 * screenshots so they always match the real UI and both color modes.
 */

function Section({ title, visual, children }: { title: string; visual: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-neutral-200 p-4 dark:border-neutral-800">
      <h2 className="mb-3 text-base font-semibold">{title}</h2>
      <div className="mb-3">{visual}</div>
      <div className="flex flex-col gap-2 text-sm leading-relaxed text-neutral-700 dark:text-neutral-300">
        {children}
      </div>
    </section>
  );
}

/* --- tiny visuals, mimicking the real UI --- */

function VisualTiles() {
  return (
    <div className="grid grid-cols-4 gap-2">
      <div className="rounded-lg border border-emerald-600 bg-emerald-50 p-2 text-center text-sm font-semibold text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
        401<div className="text-[10px] font-normal">done</div>
      </div>
      <div className="rounded-lg border border-amber-500 bg-amber-50 p-2 text-center text-sm font-semibold text-amber-700 dark:bg-amber-950 dark:text-amber-300">
        402<div className="text-[10px] font-normal">started</div>
      </div>
      <div className="rounded-lg border border-neutral-300 p-2 text-center text-sm font-semibold text-neutral-500 dark:border-neutral-700">
        403<div className="text-[10px] font-normal">to do</div>
      </div>
      <div className="rounded-lg border border-neutral-300 p-2 text-center text-sm font-semibold text-neutral-400 line-through dark:border-neutral-700">
        404<div className="text-[10px] font-normal no-underline">skip</div>
      </div>
    </div>
  );
}

function VisualKeypad() {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-end justify-between">
        <div className="font-mono text-3xl font-semibold tabular-nums">
          74 3/4<span className="ml-1 text-sm font-normal text-neutral-500">in</span>
        </div>
        <div className="flex overflow-hidden rounded-lg border border-neutral-300 text-sm dark:border-neutral-700">
          <span className="bg-white px-3 py-1.5 text-neutral-500 dark:bg-neutral-900">⅛</span>
          <span className="bg-blue-600 px-3 py-1.5 text-white">¹⁄₁₆</span>
        </div>
      </div>
      <div className="text-xs text-neutral-500">from 74 13/16</div>
      <div className="grid grid-cols-4 gap-1.5 text-center text-xs">
        {["1/4", "5/16", "3/8", "7/16"].map((f) => (
          <span key={f} className="rounded-lg bg-neutral-100 py-2 tabular-nums dark:bg-neutral-800">{f}</span>
        ))}
      </div>
    </div>
  );
}

function VisualBay() {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex gap-1">
        <div className="flex-1 rounded border-2 border-neutral-400 p-2 text-center text-xs dark:border-neutral-600">
          34 5/8<div className="mt-1 font-semibold text-blue-600 dark:text-blue-400">Dl</div>
        </div>
        <div className="flex-[1.6] rounded border-2 border-neutral-400 p-2 text-center text-xs dark:border-neutral-600">
          53<div className="mt-1 text-neutral-400">—</div>
        </div>
        <div className="flex-1 rounded border-2 border-neutral-400 p-2 text-center text-xs dark:border-neutral-600">
          34 1/2<div className="mt-1 font-semibold text-blue-600 dark:text-blue-400">Dr</div>
        </div>
      </div>
      <div className="text-center text-xs text-neutral-500">one window frame · three blinds · “Both” trims the outer edges</div>
    </div>
  );
}

function VisualInstall() {
  return (
    <div className="flex items-center justify-around text-center text-xs">
      <div><div className="text-2xl">🟢</div>staged / my half done</div>
      <div><div className="text-2xl">✅</div>installed</div>
      <div><div className="text-2xl">⚠️</div>blocked — read the note</div>
    </div>
  );
}

function VisualWarning() {
  return (
    <div className="rounded-lg border border-amber-400 bg-amber-50 p-2 text-xs text-amber-900 dark:border-amber-600 dark:bg-amber-950/40 dark:text-amber-200">
      ⚠️ side panels differ: 29 vs 34 7/8 — bay sides are usually near-equal, double-check this one
    </div>
  );
}

function VisualSync() {
  return (
    <div className="flex items-center justify-around text-center text-xs text-neutral-600 dark:text-neutral-300">
      <div><div className="text-lg">📴</div>no signal?<br />keep working</div>
      <div className="text-neutral-400">→</div>
      <div><div className="text-lg">☁️</div>syncs itself<br />when signal returns</div>
      <div className="text-neutral-400">→</div>
      <div><div className="text-lg">📱</div>whole crew<br />sees it</div>
    </div>
  );
}

export default function HelpPage() {
  const router = useRouter();

  return (
    <main className="mx-auto flex max-w-md flex-1 flex-col gap-4 p-4 pb-12">
      <header className="safe-sticky-top sticky z-20 -mx-4 flex items-center gap-3 bg-white/95 px-4 pb-3 backdrop-blur dark:bg-neutral-950/95">
        <button type="button" onClick={() => router.back()} className="min-h-11 min-w-11 shrink-0 text-xl">
          ←
        </button>
        <h1 className="text-xl font-semibold">How to use Measure</h1>
      </header>

      <Section title="The unit grid" visual={<VisualTiles />}>
        <p>Every box is a unit (or a zone, on office jobs). Tap one to measure its windows.</p>
        <p>Green means finished, orange means started, plain means not touched yet. Struck-through means skip it (nobody home, no blinds needed).</p>
        <p>Tap the <b>⋯</b> on a tile to mark it done, skip it, or leave a note.</p>
      </Section>

      <Section title="Entering a measurement" visual={<VisualKeypad />}>
        <p>Pick the room (LR = living room, BR = bedroom, MBR = master). Tap the numbers, then the fraction. Width first, then Height — it flips automatically.</p>
        <p>Using a laser that reads 1/16ths? Tap the <b>¹⁄₁₆</b> switch and punch in exactly what the laser says. The app rounds it down to the eighth the factory wants and remembers the raw number.</p>
        <p>Everything saves by itself the moment you tap it. <b>Save · next window</b> just moves you to the next one.</p>
        <p>The floor&apos;s <b>Mount</b> setting (Tight / Inside / Outside) goes on every exported row automatically — set it once in the floor&apos;s Edit bar. One odd window? Override it right on that window.</p>
      </Section>

      <Section title="Bay windows: use + panel" visual={<VisualBay />}>
        <p>One window frame holding two or three blinds side by side? That&apos;s ONE window here. Enter the first width, tap <b>+ panel</b>, enter the next.</p>
        <p>Fabric deducts on a bay go where fabric can actually come off: <b>Both</b> trims the left edge of the left blind and the right edge of the right blind. Middle blinds are never touched.</p>
        <p>Several separate identical blinds instead (same size, same room)? Enter it once and set <b>Quantity</b>.</p>
      </Section>

      <Section title="Orange warnings" visual={<VisualWarning />}>
        <p>If a number looks off — way too small, way too big, or a bay with very different sides — the app flags it in orange and says why.</p>
        <p>It never blocks you. If the window really is like that, ignore the flag. But a flag has caught a wrongly-cut blind before, so give it a second look.</p>
      </Section>

      <Section title="Notes and photos" visual={
        <div className="flex items-center gap-2">
          <div className="flex h-14 w-14 items-center justify-center rounded-lg border border-dashed border-neutral-300 text-xl dark:border-neutral-700">📷</div>
          <div className="rounded-lg border border-neutral-200 p-2 text-xs text-neutral-500 dark:border-neutral-800">“needs fascia — see photo”</div>
        </div>
      }>
        <p>Every unit has a note (📝 at the top of its screen): shims, missing hardware, PRIORITY, whatever the next person needs to know.</p>
        <p>Add a photo right in the note — point the camera at the problem. The whole crew sees it on their own phones.</p>
      </Section>

      <Section title="Install mode" visual={<VisualInstall />}>
        <p>On a floor, flip the switch at the top from <b>Measure</b> to <b>Install</b>. Tap a unit and mark it.</p>
        <p>🟢 staged means the blinds and hardware are dropped off and ready — or your half of the work is done and it&apos;s ready for your partner. ✅ means installed. ⚠️ blocked means something is stopping the install; the note says what.</p>
      </Section>

      <Section title="Sending to the factory" visual={
        <div className="rounded-lg bg-neutral-800 p-3 text-center text-sm font-medium text-white dark:bg-neutral-100 dark:text-neutral-900">
          Export → “44 Charles - Batch 4.xlsx”
        </div>
      }>
        <p>When a floor is measured, tap <b>Export</b>. You get the exact spreadsheet the factory expects, and your phone&apos;s share sheet sends it — Google Drive, email, AirDrop.</p>
        <p>Export works with no signal too. The file is made right on the phone.</p>
      </Section>

      <Section title="No signal? No problem" visual={<VisualSync />}>
        <p>The app works completely offline — basements, elevators, parking garages. Nothing is ever lost.</p>
        <p>The status in the top-right corner tells you where things stand: a number means changes waiting to upload, <b>✓ synced</b> means everyone has everything. Tap it for a <b>Sync now</b> button.</p>
        <p>Sign in once (it emails you a code) so your work shares with the rest of the crew.</p>
      </Section>
    </main>
  );
}
