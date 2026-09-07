// The external project manager's slice of the app (see
// docs/superpowers/specs/2026-09-06-pm-view-design.md).
//
// Deliberately separate from lib/sync: the PM has no account, no local
// database and no company. They hold a token and call two server functions
// through the anon client, and that is the entire surface.
import { createClient } from "@supabase/supabase-js";
import { computeTagLabels } from "./tags";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const anon =
  SUPABASE_URL && SUPABASE_ANON_KEY
    ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      })
    : null;

/** Exactly what pm_project_status returns — nothing about sizes, notes or money. */
export interface PmWindow {
  id: string;
  tag_base: string;
  sort_order: number;
}
export interface PmDeficiency {
  id: string;
  window_id: string | null;
  note: string;
  status: "open" | "resolved";
  raised_at: string;
}
export interface PmUnit {
  id: string;
  number: string;
  done: boolean;
  windows: PmWindow[];
  deficiencies: PmDeficiency[];
}
export interface PmFloor {
  id: string;
  label: string;
  units: PmUnit[];
}
export interface PmProject {
  project: { name: string; address: string };
  label: string;
  floors: PmFloor[];
}

/** null = unknown or revoked token (the server says nothing more than that). */
export async function fetchPmProject(token: string): Promise<PmProject | null> {
  if (!anon) return null;
  const { data, error } = await anon.rpc("pm_project_status", { share_token: token });
  if (error) throw new Error(error.message);
  return (data as PmProject | null) ?? null;
}

/** Returns the new deficiency id, or null when the server refused. */
export async function flagPmDeficiency(
  token: string,
  unitId: string,
  windowId: string | null,
  note: string
): Promise<string | null> {
  if (!anon) return null;
  const { data, error } = await anon.rpc("pm_flag_deficiency", {
    share_token: token,
    target_unit: unitId,
    target_window: windowId,
    complaint: note,
  });
  if (error) throw new Error(error.message);
  return (data as string | null) ?? null;
}

/**
 * Window labels the way the crew sees them ("LR", "LR1", "BR"), from the
 * same computeTagLabels the unit screen uses, so a PM saying "LR2 is
 * scratched" names the blind the installer would name. Untagged zone-run
 * windows are numbered by position, as on the unit screen.
 */
export function pmWindowLabels(unit: Pick<PmUnit, "windows">): Map<string, string> {
  const tagged = unit.windows.filter((w) => w.tag_base !== "");
  const labels = computeTagLabels(
    tagged.map((w) => ({ id: w.id, tag_base: w.tag_base, sort_order: w.sort_order, deleted: false }))
  );
  const out = new Map<string, string>();
  unit.windows.forEach((w, i) => {
    out.set(w.id, w.tag_base === "" ? `#${i + 1}` : (labels.get(w.id) ?? w.tag_base));
  });
  return out;
}

/** "3 of 12 done" style progress for a floor or the whole project. */
export function pmProgress(units: Pick<PmUnit, "done">[]): { done: number; total: number } {
  return { done: units.filter((u) => u.done).length, total: units.length };
}

/** The link a PM is handed. Absolute, so it works pasted into a text message. */
export function pmShareUrl(token: string, origin: string): string {
  return `${origin.replace(/\/$/, "")}/pm/${token}`;
}
