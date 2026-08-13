import { listWindows, upsertWindow } from "@/lib/db";
import { computeTagLabels } from "@/lib/tags";

/**
 * Re-derive every window's tag_index in a unit from computeTagLabels and
 * persist any that changed.
 *
 * lib/tags.ts computes display labels ("LR", "LR1", "LR2"...) live from
 * tag_base + sort_order, ignoring the stored tag_index entirely — that's how
 * the UI renders chips. But the exporter (lib/export/exporter.ts) trusts the
 * *stored* tag_index as already-final and builds "{unit}-{tag_base}{tag_index}"
 * straight from it. So whenever a unit's window set changes in a way that
 * could shift numbering (add/delete/tag_base edit), the UI must write the
 * freshly-computed label's numeric suffix back into tag_index — this is the
 * "export renames retroactively" behaviour the spec calls out. Call this
 * after any such change.
 *
 * Untagged windows (tag_base === "", office/zone-run entry — see
 * fixtures/seed-projects.json's Alcon project) are deliberately excluded
 * from computeTagLabels entirely: a zone run can hold 30-100+ untagged
 * windows sharing tag_base "", and routing them through computeTagLabels
 * would group them together and number them "1", "2", "3"... which the
 * exporter would then render as dash-suffixed rows ("Level 1-2") instead of
 * the bare zone label every untagged row must export as. Untagged windows
 * always keep tag_index 0.
 */
export async function syncUnitTagIndices(unitId: string): Promise<void> {
  const windows = await listWindows(unitId);
  const tagged = windows.filter((w) => w.tag_base !== "");
  const labels = computeTagLabels(tagged);

  await Promise.all(
    windows.map((w) => {
      if (w.tag_base === "") {
        if (w.tag_index === 0) return Promise.resolve();
        return upsertWindow({ ...w, tag_index: 0 });
      }
      const label = labels.get(w.id) ?? w.tag_base;
      const suffix = label.slice(w.tag_base.length);
      const nextIndex = suffix === "" ? 0 : parseInt(suffix, 10);
      if (nextIndex === w.tag_index) return Promise.resolve();
      return upsertWindow({ ...w, tag_index: nextIndex });
    })
  );
}
