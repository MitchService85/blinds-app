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
  /** The PM's own words — only deficiencies raised through this link come back. */
  note: string;
  status: "open" | "resolved";
  raised_at: string;
  /** When the crew marked it fixed. Added by 015; absent before it is applied. */
  resolved_at?: string | null;
}
export interface PmUnit {
  id: string;
  number: string;
  done: boolean;
  /** The crew could not get in — the PM arranges access. */
  locked: boolean;
  /** Needs a revisit. The reason stays internal; the PM sees only the fact. */
  blocked: boolean;
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
  /** The installer's company name, so the PM knows who sent the link. Added
   * by 015; absent before it is applied. */
  company?: string | null;
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
 * Room words for the crew's tags. A PM thinks "the living room blind", not
 * "LR2" (PM review, 2026-10-24: the chips read as part numbers), so the room
 * is the label and the crew's code rides along in small text — that is still
 * what the installer will say back. Anything else stays exactly as typed.
 */
const ROOM_NAMES: Record<string, string> = {
  LR: "Living room",
  BR: "Bedroom",
  MBR: "Main bedroom",
  K: "Kitchen",
  KIT: "Kitchen",
  DEN: "Den",
  STU: "Study",
};

export interface PmBlindLabel {
  /** "Living room 2", "Bedroom", "Blind 3", or the tag as typed. */
  name: string;
  /** The crew's code ("LR2") when it differs from the name, else "". */
  code: string;
}

/**
 * Blind labels for the PM, from the same computeTagLabels the unit screen
 * uses, so the code beside the room name ("LR2") is the one the installer
 * would name. A repeated room is numbered the same way ("Living room 1",
 * "Living room 2"). Untagged zone-run windows are numbered by position, as
 * on the unit screen.
 */
export function pmWindowLabels(unit: Pick<PmUnit, "windows">): Map<string, PmBlindLabel> {
  const tagged = unit.windows.filter((w) => w.tag_base !== "");
  const labels = computeTagLabels(
    tagged.map((w) => ({ id: w.id, tag_base: w.tag_base, sort_order: w.sort_order, deleted: false }))
  );
  const out = new Map<string, PmBlindLabel>();
  unit.windows.forEach((w, i) => {
    if (w.tag_base === "") {
      out.set(w.id, { name: `Blind ${i + 1}`, code: "" });
      return;
    }
    const code = labels.get(w.id) ?? w.tag_base;
    const room = ROOM_NAMES[w.tag_base.trim().toUpperCase()];
    if (!room) {
      out.set(w.id, { name: code, code: "" });
      return;
    }
    const n = code.slice(w.tag_base.length);
    out.set(w.id, { name: n ? `${room} ${n}` : room, code });
  });
  return out;
}

/**
 * "36 of 55 units complete" for a floor or the whole project, plus the two
 * kinds of unit the PM is told about. Complete means what the tile says:
 * installed AND not waiting on a revisit or on access — counting every
 * installed unit put "40 of 55 done" over a grid with five amber tiles in it
 * (PM review, 2026-10-24). "Being fixed" counts every amber tile and "no
 * access" every violet one, so each number can be checked against the grid.
 */
export function pmProgress(units: Pick<PmUnit, "done" | "blocked" | "locked">[]): {
  complete: number;
  total: number;
  fixing: number;
  noAccess: number;
} {
  return {
    complete: units.filter(pmComplete).length,
    total: units.length,
    fixing: units.filter((u) => u.blocked && !u.locked).length,
    noAccess: units.filter((u) => u.locked).length,
  };
}

export function pmComplete(u: Pick<PmUnit, "done" | "blocked" | "locked">): boolean {
  return u.done && !u.blocked && !u.locked;
}

/** What a unit's tile and panel say, decided in this order. */
export type PmUnitKind = "locked" | "yourReport" | "returnVisit" | "complete" | "notYet";

export function pmUnitKind(u: Pick<PmUnit, "done" | "blocked" | "locked" | "deficiencies">): PmUnitKind {
  if (u.locked) return "locked";
  if (u.blocked) {
    // The server sends only this link's deficiencies, so an open one here is
    // the PM's own. A block with none of theirs is the crew's reason, which
    // stays private: the PM is only told someone is coming back.
    return u.deficiencies.some((d) => d.status === "open") ? "yourReport" : "returnVisit";
  }
  return u.done ? "complete" : "notYet";
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Oct 20", in the viewer's time zone. */
export function pmDate(iso: string): string {
  const d = new Date(iso);
  return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

/** "2:14 pm" — when the page last loaded. */
export function pmTime(d: Date): string {
  const h = d.getHours();
  return `${h % 12 || 12}:${String(d.getMinutes()).padStart(2, "0")} ${h < 12 ? "am" : "pm"}`;
}

/** "units 1201–1312" under a floor heading, so a PM can find their unit's floor. */
export function pmUnitRange(units: Pick<PmUnit, "number">[]): string {
  if (units.length === 0) return "";
  if (units.length === 1) return `unit ${units[0].number}`;
  return `units ${units[0].number}–${units[units.length - 1].number}`;
}

/** The link a PM is handed. Absolute, so it works pasted into a text message. */
export function pmShareUrl(token: string, origin: string): string {
  return `${origin.replace(/\/$/, "")}/pm/${token}`;
}
