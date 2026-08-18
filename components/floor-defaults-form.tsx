"use client";

import type { FloorDefaults, MountType } from "@/lib/types";

interface FloorDefaultsFormProps {
  value: FloorDefaults;
  onChange: (value: FloorDefaults) => void;
}

const COLOR_KEYS = ["bed", "liv", "studio", "kitchen"] as const;

/** Shared per-floor defaults editor — used by the new job wizard, the project
 * hub's "+ Add floor", and the floor view's defaults bar (see spec). */
export function FloorDefaultsForm({ value, onChange }: FloorDefaultsFormProps) {
  function patch(partial: Partial<FloorDefaults>) {
    onChange({ ...value, ...partial });
  }

  function patchColor(key: (typeof COLOR_KEYS)[number], v: string) {
    onChange({ ...value, color_codes: { ...value.color_codes, [key]: v } });
  }

  return (
    <div className="flex flex-col gap-4">
      <label className="flex min-h-11 items-center gap-3">
        <input
          type="checkbox"
          checked={value.roll}
          onChange={(e) => patch({ roll: e.target.checked })}
          className="h-5 w-5"
        />
        <span className="text-sm">
          Reverse roll <span className="text-neutral-400">(exports &quot;Rev&quot;)</span>
        </span>
      </label>

      <div>
        <div className="mb-1 text-sm text-neutral-500">Drive / control default</div>
        <div className="flex overflow-hidden rounded-lg border border-neutral-300 dark:border-neutral-700">
          {(["L", "R"] as const).map((side) => (
            <button
              key={side}
              type="button"
              onClick={() => patch({ drive: side })}
              aria-pressed={value.drive === side}
              className={`min-h-11 flex-1 text-sm font-medium ${
                value.drive === side
                  ? "bg-blue-600 text-white"
                  : "bg-white text-neutral-700 dark:bg-neutral-900 dark:text-neutral-300"
              }`}
            >
              {side === "L" ? "Left" : "Right"}
            </button>
          ))}
        </div>
      </div>

      <label className="flex min-h-11 items-center gap-3">
        <input
          type="checkbox"
          checked={value.tight === true || value.mount === "inside_tight"}
          onChange={(e) =>
            // Clear the legacy combined value: "inside_tight" used to carry
            // the tight meaning, and leaving it set would re-apply it.
            patch({
              tight: e.target.checked,
              mount: value.mount === "inside_tight" ? null : value.mount,
            })
          }
          className="h-5 w-5"
        />
        <span className="text-sm">
          Tight measures <span className="text-neutral-400">(how it was measured)</span>
        </span>
      </label>

      <div>
        <div className="mb-1 text-sm text-neutral-500">Mount (where the blind sits)</div>
        <div className="flex overflow-hidden rounded-lg border border-neutral-300 dark:border-neutral-700">
          {(
            [
              [null, "Not noted"],
              ["inside", "Inside"],
              ["outside", "Outside"],
            ] as Array<[MountType, string]>
          ).map(([mount, label]) => {
            const current = value.mount === "inside_tight" ? null : (value.mount ?? null);
            return (
              <button
                key={label}
                type="button"
                onClick={() => patch({ mount })}
                aria-pressed={current === mount}
                className={`min-h-11 flex-1 text-sm font-medium ${
                  current === mount
                    ? "bg-blue-600 text-white"
                    : "bg-white text-neutral-600 dark:bg-neutral-900 dark:text-neutral-300"
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>

      <label className="flex min-h-11 items-center gap-3">
        <input
          type="checkbox"
          checked={value.motorized === true}
          onChange={(e) => patch({ motorized: e.target.checked })}
          className="h-5 w-5"
        />
        <span className="text-sm">
          Motorized <span className="text-neutral-400">(whole floor; override per window)</span>
        </span>
      </label>

      <div>
        <div className="mb-1 text-sm text-neutral-500">
          Chain type <span className="text-neutral-400">(optional)</span>
        </div>
        <input
          type="text"
          value={value.chain_type ?? ""}
          onChange={(e) => patch({ chain_type: e.target.value })}
          placeholder="e.g. Metal"
          className="min-h-11 w-full rounded-lg border border-neutral-300 px-3 text-sm dark:border-neutral-700 dark:bg-neutral-900"
        />
      </div>

      <div>
        <div className="mb-1 text-sm text-neutral-500">Extra note (applied to every window)</div>
        <textarea
          value={value.extra_note}
          onChange={(e) => patch({ extra_note: e.target.value })}
          placeholder="e.g. DRILL HOLES IN FASCIA"
          rows={2}
          className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900"
        />
      </div>

      <div>
        <div className="mb-1 text-sm text-neutral-500">D value</div>
        <input
          type="text"
          value={value.d_value}
          onChange={(e) => patch({ d_value: e.target.value })}
          className="min-h-11 w-full rounded-lg border border-neutral-300 px-3 text-sm dark:border-neutral-700 dark:bg-neutral-900"
        />
      </div>

      <details className="rounded-lg border border-neutral-200 p-3 dark:border-neutral-800">
        <summary className="cursor-pointer text-sm text-neutral-500">
          Fabric color codes (optional)
        </summary>
        <div className="mt-3 grid grid-cols-2 gap-3">
          {COLOR_KEYS.map((key) => (
            <div key={key}>
              <div className="mb-1 text-xs capitalize text-neutral-500">{key}</div>
              <input
                type="text"
                value={value.color_codes[key]}
                onChange={(e) => patchColor(key, e.target.value)}
                className="min-h-11 w-full rounded-lg border border-neutral-300 px-3 text-sm dark:border-neutral-700 dark:bg-neutral-900"
              />
            </div>
          ))}
        </div>
      </details>
    </div>
  );
}
