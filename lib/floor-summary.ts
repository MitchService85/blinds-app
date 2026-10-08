// A floor's settings as a short row of words — the chips at the top of a
// floor, and the folded "Floor settings" line on the New job form. One
// function so the two can never describe the same floor differently.
import { effectiveMeasure, effectiveMount } from "./export/shared";
import type { FloorDefaults } from "./types";

type SummaryDefaults = Pick<
  FloorDefaults,
  "roll" | "drive" | "tight" | "measure" | "mount" | "motorized" | "chain_type" | "d_value" | "extra_note"
>;

/**
 * `showUnset` names the two settings that are easy to forget and costly to
 * get wrong — how it was measured, and where it sits — even when nobody has
 * picked them. On a floor's chips the absence is enough; on a form that is
 * folded shut, "Measure not noted" is the only prompt there is.
 *
 * "Deduct ½" rather than the sheet's "D=½": the chips are read by people,
 * the sheet by the factory (which still gets "D = ½"). "Drive" stays — it is
 * the drive end, gear or clutch, whether or not the blind has a chain.
 */
export function floorSettingParts(d: SummaryDefaults, opts: { showUnset?: boolean } = {}): string[] {
  const measure = effectiveMeasure(d);
  const mount = effectiveMount(d);
  const parts: (string | null)[] = [
    d.roll ? "Rev" : null,
    `Drive ${d.drive}`,
    measure === "tight" ? "Tight" : measure === "finished" ? "Finished" : opts.showUnset ? "Measure not noted" : null,
    mount === "inside" ? "Inside" : mount === "outside" ? "Outside" : opts.showUnset ? "Mount not noted" : null,
    d.motorized ? "Motorized" : null,
    d.chain_type ? `${d.chain_type} chain` : null,
    d.d_value ? `Deduct ${d.d_value}` : null,
    d.extra_note || null,
  ];
  return parts.filter((p): p is string => Boolean(p));
}
