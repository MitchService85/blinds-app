import Link from "next/link";
import type { Project } from "@/lib/types";

export interface FloorProgress {
  id: string;
  label: string;
  done: number;
  total: number;
}

interface JobCardProps {
  project: Project;
  floors: FloorProgress[];
}

/**
 * Dashboard job card. The floor progress chips are their own links straight
 * into that floor's view (not nested inside the card's own link — the card
 * header links to the project hub instead) so a single tap from the
 * dashboard reaches the floor you want to work on.
 */
export function JobCard({ project, floors }: JobCardProps) {
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

      {floors.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {floors.map((f) => (
            <Link
              key={f.id}
              href={`/project/${project.id}/floor/${f.id}`}
              className="min-h-9 rounded-full border border-neutral-200 px-3 py-1.5 text-xs font-medium active:bg-neutral-100 dark:border-neutral-700 dark:active:bg-neutral-800"
            >
              {f.label} {f.total > 0 && f.done === f.total ? "✓" : `${f.done}/${f.total}`}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
