import Link from "next/link";
import type { Project } from "@/lib/types";
import { formatCents } from "@/lib/pricing";

export interface FloorProgress {
  id: string;
  label: string;
  done: number;
  total: number;
  /** Total blinds on the floor (each bay panel is one blind) */
  blinds: number;
  /** null when the floor has zero install activity (nothing staged, done,
   * or blocked yet) — the second chip line is hidden in that case. */
  install: { staged: number; done: number; blocked: number } | null;
}

/** Invoicing position for the card's money line; null when nothing is invoiced. */
export interface JobMoney {
  /** Total of sent + paid invoices. */
  invoiced_cents: number;
  /** Total of invoices sent and not yet paid. */
  outstanding_cents: number;
  drafts: number;
}

interface JobCardProps {
  project: Project;
  floors: FloorProgress[];
  money?: JobMoney | null;
  /** Open PM deficiencies on this job. */
  deficiencies?: number;
}

/**
 * Dashboard job card. The floor progress chips are their own links straight
 * into that floor's view (not nested inside the card's own link — the card
 * header links to the project hub instead) so a single tap from the
 * dashboard reaches the floor you want to work on.
 */
export function JobCard({ project, floors, money = null, deficiencies = 0 }: JobCardProps) {
  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
      <Link href={`/project/${project.id}`} className="block">
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="font-semibold">{project.name}</div>
            <div className="text-sm text-neutral-500">{project.address}</div>
          </div>
          <span className="shrink-0 rounded-full bg-neutral-100 px-2 py-0.5 text-xs capitalize text-neutral-500 dark:bg-neutral-800">
            {project.building_type}
          </span>
        </div>
      </Link>

      {deficiencies > 0 && (
        <div className="mt-2 text-xs font-medium text-rose-700 dark:text-rose-300">
          {deficiencies} open PM deficienc{deficiencies === 1 ? "y" : "ies"}
        </div>
      )}
      {money && (
        <div className="mt-2 text-xs text-neutral-500 dark:text-neutral-400">
          {money.invoiced_cents > 0 && `${formatCents(money.invoiced_cents)} invoiced`}
          {money.outstanding_cents > 0 && (
            <span className="text-amber-700 dark:text-amber-300">
              {" "}· {formatCents(money.outstanding_cents)} outstanding
            </span>
          )}
          {money.drafts > 0 &&
            `${money.invoiced_cents > 0 ? " · " : ""}${money.drafts} draft invoice${money.drafts === 1 ? "" : "s"}`}
        </div>
      )}

      {floors.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-x-3 gap-y-2">
          {floors.map((f) => (
            <div key={f.id} className="flex flex-col gap-0.5">
              <Link
                href={`/project/${project.id}/floor/${f.id}`}
                className="min-h-9 rounded-full border border-neutral-200 px-3 py-1.5 text-xs font-medium active:bg-neutral-100 dark:border-neutral-700 dark:active:bg-neutral-800"
              >
                {f.label} {f.total > 0 && f.done === f.total ? "✓" : `${f.done}/${f.total}`}
                <span className="ml-1 text-neutral-400">
                  · {f.blinds} blind{f.blinds === 1 ? "" : "s"}
                </span>
              </Link>
              {f.install && (
                <div className="px-1 text-[11px] text-neutral-500 dark:text-neutral-400">
                  install 🟢{f.install.staged} ✅{f.install.done} ⚠️{f.install.blocked}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
