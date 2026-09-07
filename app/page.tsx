"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { isDemoRow, seedDemoIfNeeded } from "@/lib/demo";
import { db, listProjects } from "@/lib/db";
import { useSyncStatus } from "@/lib/sync";
import { windowBlindCount } from "@/lib/export/shared";
import type { InvoiceRecord, Project } from "@/lib/types";
import { formatCents } from "@/lib/pricing";
import { JobCard, type FloorProgress, type JobMoney } from "@/components/job-card";
import { SyncStatus } from "@/components/sync-status";
import { blockedOf, installOf } from "@/components/status";

interface ProjectRow {
  project: Project;
  floors: FloorProgress[];
  money: JobMoney | null;
}

/** Cross-job totals for the strip at the top — the recap Mitch asked for
 * before opening any one job. Everything here is derived from rows the
 * dashboard already loads; nothing is stored. */
interface Overview {
  jobs: number;
  blinds: number;
  /** Units not yet installed, excluding N/A and blocked. */
  to_install: number;
  blocked: number;
  outstanding_cents: number;
  drafts: number;
}

function moneyFor(invoices: InvoiceRecord[]): JobMoney | null {
  if (invoices.length === 0) return null;
  let invoiced = 0;
  let outstanding = 0;
  let drafts = 0;
  for (const inv of invoices) {
    if (inv.status === "draft") drafts++;
    else {
      invoiced += inv.total_cents;
      if (inv.status === "sent") outstanding += inv.total_cents;
    }
  }
  return { invoiced_cents: invoiced, outstanding_cents: outstanding, drafts };
}

export default function Home() {
  const [rows, setRows] = useState<ProjectRow[] | null>(null);
  const { signedIn } = useSyncStatus();

  useEffect(() => {
    let cancelled = false;

    async function load() {
      // The sandbox exists so a signed-out visitor has something to try. It
      // used to be four real client jobs, which meant anyone opening the app
      // saw a customer's measurements.
      await seedDemoIfNeeded();
      // Four bulk reads and in-memory grouping. The obvious per-project /
      // per-floor / per-unit queries are ~100 sequential IndexedDB round
      // trips on today's data and grow with every job — noticeable on a
      // phone, and the dashboard is the screen that opens most.
      const [projects, allFloors, allUnits, allWindows, allInvoices] = await Promise.all([
        listProjects(),
        db.floors.filter((f) => !f.deleted).toArray(),
        db.units.filter((u) => !u.deleted).toArray(),
        db.windows.filter((w) => !w.deleted).toArray(),
        db.invoices.filter((i) => !i.deleted).toArray(),
      ]);
      const invoicesByProject = new Map<string, InvoiceRecord[]>();
      for (const inv of allInvoices) {
        const list = invoicesByProject.get(inv.project_id) ?? [];
        list.push(inv);
        invoicesByProject.set(inv.project_id, list);
      }

      const floorsByProject = new Map<string, typeof allFloors>();
      for (const f of allFloors) {
        const list = floorsByProject.get(f.project_id) ?? [];
        list.push(f);
        floorsByProject.set(f.project_id, list);
      }
      const unitsByFloor = new Map<string, typeof allUnits>();
      for (const u of allUnits) {
        const list = unitsByFloor.get(u.floor_id) ?? [];
        list.push(u);
        unitsByFloor.set(u.floor_id, list);
      }
      const blindsByUnit = new Map<string, number>();
      for (const w of allWindows) {
        blindsByUnit.set(w.unit_id, (blindsByUnit.get(w.unit_id) ?? 0) + windowBlindCount(w));
      }

      // Signed out you get the sandbox and nothing else; signed in you get
      // your company's real jobs and not the sandbox. The server already
      // refuses another tenant's rows — this is the local half, so a shared
      // or borrowed phone cannot show a client's work to whoever picks it up.
      const visible = projects.filter((p) => (signedIn ? !isDemoRow(p) : isDemoRow(p)));

      const nextRows: ProjectRow[] = visible.map((project) => {
        const floorProgress: FloorProgress[] = (floorsByProject.get(project.id) ?? []).map(
          (floor) => {
            const relevant = (unitsByFloor.get(floor.id) ?? []).filter((u) => u.status !== "na");
            let blinds = 0;
            let installStaged = 0;
            let installDone = 0;
            let installBlocked = 0;
            for (const unit of relevant) {
              blinds += blindsByUnit.get(unit.id) ?? 0;
              if (blockedOf(unit)) installBlocked++;
              else if (installOf(unit) === "staged") installStaged++;
              else if (installOf(unit) === "done") installDone++;
            }
            const hasInstallActivity = installStaged + installDone + installBlocked > 0;
            return {
              id: floor.id,
              label: floor.label,
              done: relevant.filter((u) => u.status === "done").length,
              total: relevant.length,
              blinds,
              install: hasInstallActivity
                ? { staged: installStaged, done: installDone, blocked: installBlocked }
                : null,
            };
          }
        );
        return {
          project,
          floors: floorProgress,
          money: moneyFor(invoicesByProject.get(project.id) ?? []),
        };
      });

      if (!cancelled) setRows(nextRows);
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [signedIn]);

  const overview: Overview | null =
    rows && rows.length > 0
      ? rows.reduce<Overview>(
          (acc, row) => {
            acc.jobs += 1;
            for (const f of row.floors) {
              acc.blinds += f.blinds;
              const installed = f.install?.done ?? 0;
              const blocked = f.install?.blocked ?? 0;
              acc.blocked += blocked;
              acc.to_install += Math.max(0, f.total - installed - blocked);
            }
            acc.outstanding_cents += row.money?.outstanding_cents ?? 0;
            acc.drafts += row.money?.drafts ?? 0;
            return acc;
          },
          { jobs: 0, blinds: 0, to_install: 0, blocked: 0, outstanding_cents: 0, drafts: 0 }
        )
      : null;

  return (
    <main className="flex flex-1 flex-col gap-4 p-4 pb-24">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Measure</h1>
        <div className="flex items-center gap-3">
          <SyncStatus />
          <Link
            href="/company"
            className="flex min-h-11 items-center gap-1.5 rounded-full border border-neutral-300 px-3 text-sm text-neutral-600 dark:border-neutral-700 dark:text-neutral-300"
          >
            <span aria-hidden>⚙</span>
            Settings
          </Link>
          <Link
            href="/help"
            aria-label="How to use Measure"
            className="flex h-8 w-8 items-center justify-center rounded-full border border-neutral-300 text-sm font-semibold text-neutral-500 dark:border-neutral-700 dark:text-neutral-400"
          >
            ?
          </Link>
        </div>
      </header>

      {rows === null && <div className="text-sm text-neutral-500">Loading…</div>}

      {overview && (
        <section
          aria-label="Overview"
          className="grid grid-cols-3 gap-2 rounded-xl border border-neutral-200 p-3 dark:border-neutral-800"
        >
          <Stat label={overview.jobs === 1 ? "job" : "jobs"} value={String(overview.jobs)} />
          <Stat label="blinds" value={overview.blinds.toLocaleString("en-CA")} />
          <Stat label="to install" value={String(overview.to_install)} />
          <Stat
            label="blocked"
            value={String(overview.blocked)}
            tone={overview.blocked > 0 ? "amber" : undefined}
          />
          <Stat
            label="outstanding"
            value={formatCents(overview.outstanding_cents)}
            tone={overview.outstanding_cents > 0 ? "amber" : undefined}
            wide
          />
          {overview.drafts > 0 && (
            <Stat label={overview.drafts === 1 ? "draft invoice" : "draft invoices"} value={String(overview.drafts)} />
          )}
        </section>
      )}

      {rows !== null && rows.length === 0 && (
        <div className="rounded-xl border border-dashed border-neutral-300 p-6 text-center text-sm text-neutral-500 dark:border-neutral-700">
          No jobs yet. Tap + New to start one.
        </div>
      )}

      <div className="flex flex-col gap-3">
        {rows?.map((row) => (
          <JobCard key={row.project.id} project={row.project} floors={row.floors} money={row.money} />
        ))}
      </div>

      <Link
        href="/new"
        className="fixed bottom-5 right-5 flex h-14 items-center gap-2 rounded-full bg-blue-600 px-5 text-white shadow-lg active:bg-blue-700"
      >
        <span className="text-xl leading-none">+</span>
        <span className="text-sm font-medium">New</span>
      </Link>
    </main>
  );
}

function Stat({
  label,
  value,
  tone,
  wide = false,
}: {
  label: string;
  value: string;
  tone?: "amber";
  wide?: boolean;
}) {
  return (
    <div className={`flex flex-col ${wide ? "col-span-2" : ""}`}>
      <span
        className={`text-lg font-semibold tabular-nums leading-tight ${
          tone === "amber" ? "text-amber-700 dark:text-amber-300" : ""
        }`}
      >
        {value}
      </span>
      <span className="text-[11px] text-neutral-500 dark:text-neutral-400">{label}</span>
    </div>
  );
}
