// What makes ONE blind different from the rest of its floor, as a row of
// short badges.
//
// Everything a window can override lives behind "More options", so a blind
// set to Finished, or outside-mounted, or wired for a left control, looked
// exactly like its neighbours in the list. The M badge proved the shape of
// the fix (field note, 2026-09-15: "that way I can tell which ones I've
// changed without opening the window up") — this generalises it to every
// per-window setting.
//
// Kept pure and separate from the JSX so the rules are testable: which
// badge, for which stored state, is the part that has to be right.
import { effectiveMotorized, measureOverrideOf, normalizeMount } from "./export/shared";
import type { FloorDefaults, WindowRecord } from "./types";

/**
 * Visual families, not colours-by-field. Badges that mean "this changes what
 * the factory builds" (motor, convention) read louder than bookkeeping ones.
 */
export type BadgeTone =
  | "deduct"
  | "control"
  | "motor"
  | "motor-off"
  | "convention"
  | "chain"
  | "note";

export interface WindowBadge {
  /** React key and test handle. */
  key: string;
  /** Short text on the badge. Empty when `icon` carries it instead. */
  label: string;
  /** Long-press/hover text — the badge spelled out in words. */
  title: string;
  tone: BadgeTone;
  /** Set instead of `label` for the note badge. */
  icon?: "note";
}

type BadgeWindow = Pick<
  WindowRecord,
  | "widths"
  | "deduct"
  | "control_override"
  | "panel_controls"
  | "motorized_override"
  | "measure_override"
  | "tight_override"
  | "mount_override"
  | "chain_length"
  | "longer_chain"
  | "note"
>;

type BadgeDefaults = Pick<FloorDefaults, "drive" | "motorized" | "tight" | "measure" | "mount">;

const SIDE_WORD = { L: "Left", R: "Right" } as const;

/**
 * The badges for one window, in a fixed order so a list of blinds reads down
 * the column rather than shuffling per row.
 *
 * Two of them report a RESOLVED value rather than an override — "M", and the
 * struck-through "M" — because motorization decides what gets ordered, and a
 * floor-wide default you cannot see is the thing that gets mis-ordered. The
 * rest report only what this window itself says: an explicit Tight on a tight
 * floor still earns a badge, because someone chose it here and that choice
 * should be visible where it was made.
 */
export function windowBadges(w: BadgeWindow, defaults?: BadgeDefaults): WindowBadge[] {
  const badges: WindowBadge[] = [];

  if (w.deduct) {
    badges.push({
      key: "deduct",
      label: w.deduct,
      title: `Deduct ${w.deduct}`,
      tone: "deduct",
    });
  }

  // Control side. A bay with per-panel sides shows them left to right
  // ("LRL") — one badge for the whole window, since that is how it is read
  // off the wall.
  const panels = w.widths.length;
  const perPanel = w.panel_controls?.slice(0, panels) ?? null;
  if (panels > 1 && perPanel?.some((c) => c === "L" || c === "R")) {
    const sides = Array.from(
      { length: panels },
      (_, i) => perPanel[i] ?? w.control_override ?? defaults?.drive ?? "R"
    );
    badges.push({
      key: "panel-controls",
      label: sides.join(""),
      title: `Control side per panel: ${sides.map((s) => SIDE_WORD[s]).join(", ")}`,
      tone: "control",
    });
  } else if (w.control_override === "L" || w.control_override === "R") {
    badges.push({
      key: "control",
      label: `${w.control_override}C`,
      title: `${SIDE_WORD[w.control_override]} control`,
      tone: "control",
    });
  }

  // Measure convention — the one that sent "TIGHT MEASURES" to the factory
  // for a finished blind when nothing on screen said otherwise.
  const measure = measureOverrideOf(w);
  if (measure !== undefined) {
    badges.push(
      measure === null
        ? {
            key: "measure",
            label: "No meas",
            title: "Measure convention not noted for this blind",
            tone: "convention",
          }
        : {
            key: "measure",
            label: measure === "finished" ? "Fin" : "Tight",
            title: measure === "finished" ? "Finished measures" : "Tight measures",
            tone: "convention",
          }
    );
  }

  // Mount. normalizeMount drops the legacy "inside_tight", which was never a
  // mount — it is already accounted for in the measure badge above.
  const mount = normalizeMount(w.mount_override);
  if (mount) {
    badges.push({
      key: "mount",
      label: mount === "inside" ? "In" : "Out",
      title: mount === "inside" ? "Inside mount" : "Outside mount",
      tone: "convention",
    });
  }

  if (defaults && effectiveMotorized(defaults, w.motorized_override)) {
    badges.push({ key: "motor", label: "M", title: "Motorized", tone: "motor" });
  } else if (defaults?.motorized === true && w.motorized_override === false) {
    // Silence here would be indistinguishable from a floor that isn't
    // motorized at all, on the one blind where it matters most.
    badges.push({
      key: "motor-off",
      label: "M",
      title: "Not motorized (the rest of this floor is)",
      tone: "motor-off",
    });
  }

  if (typeof w.chain_length === "number" && w.chain_length > 0) {
    badges.push({
      key: "chain",
      label: `${w.chain_length}"ch`,
      title: `${w.chain_length}" chain`,
      tone: "chain",
    });
  } else if (w.longer_chain) {
    badges.push({ key: "chain", label: "CH", title: "Longer chain", tone: "chain" });
  }

  const note = w.note.trim();
  if (note) {
    badges.push({ key: "note", label: "", title: note, tone: "note", icon: "note" });
  }

  return badges;
}
