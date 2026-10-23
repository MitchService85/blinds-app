// What counts as a problem still open on a unit or blind, in one place, so
// the unit colour, install sheet, deficiency export, fix batches and the
// dashboard can never disagree about it.
//
// Problems are Deficiency rows (one per problem, each fixed on its own). The
// window's own issue_* fields are the older single-problem form: still read
// here so a row written by a phone on an old version counts until it has
// been moved into a deficiency (lib/db adoptLegacyIssues).
import type { Deficiency, WindowRecord } from "./types";

/** raised_by on problems the crew records (PM ones carry their link's label). */
export const CREW = "Crew";

export function isCrewIssue(d: Pick<Deficiency, "raised_by" | "share_id">): boolean {
  return d.raised_by === CREW && !d.share_id;
}

export function deficiencyOpen(d: Pick<Deficiency, "status" | "deleted">): boolean {
  return !d.deleted && d.status === "open";
}

export type LegacyIssueFields = Pick<
  WindowRecord,
  "issue_note" | "issue_fault" | "issue_recut" | "issue_fixed_at" | "issue_fix_note"
>;

/** The old single-problem fields hold something. */
export function hasLegacyIssue(w: Partial<LegacyIssueFields>): boolean {
  return (w.issue_note ?? "").trim() !== "" || (w.issue_fault ?? null) !== null || w.issue_recut === true;
}

/** …and it has not been marked fixed. */
export function legacyIssueOpen(w: Partial<LegacyIssueFields>): boolean {
  return hasLegacyIssue(w) && !w.issue_fixed_at;
}

/** "Oct 23" — the way the crew reads a date. */
export function fixedDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-CA", { month: "short", day: "numeric" });
}

/**
 * A deterministic id for the deficiency a window's old issue fields become,
 * so two phones (or the server migration) moving the same issue make the same
 * row instead of two. Must match supabase/measure-migrations/014's formula:
 * the first 32 hex digits of sha256("legacy-issue:<window>:<note>:<fault>:<recut>").
 */
export async function legacyIssueId(w: Pick<WindowRecord, "id"> & Partial<LegacyIssueFields>): Promise<string> {
  const key = `legacy-issue:${w.id}:${w.issue_note ?? ""}:${w.issue_fault ?? ""}:${w.issue_recut === true}`;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key));
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}
