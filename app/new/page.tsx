"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createFloor, createProject } from "@/lib/db";
import type { BuildingType, FloorDefaults } from "@/lib/types";
import { TagChipEditor } from "@/components/tag-chip-editor";
import { FloorDefaultsForm } from "@/components/floor-defaults-form";

// Mike's own designations, which the factory processes and returns labelled
// the same way. STU covers a studio/bachelor unit.
const RESIDENTIAL_CHIPS = ["LR", "BR", "MBR", "K", "STU", "Den", "Bath"];
const COMMERCIAL_CHIPS = ["Office", "Boardroom", "Reception", "Kitchen", "Corridor"];

function defaultFloorDefaults(): FloorDefaults {
  return {
    roll: false,
    drive: "R",
    tight: false,
    measure: null,
    extra_note: "",
    d_value: "1/2",
    color_codes: { mbed: "", liv: "", bed: "", kit: "", stu: "" },
  };
}

interface DraftFloor {
  key: string;
  label: string;
  defaults: FloorDefaults;
}

export default function NewJobPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [buildingType, setBuildingType] = useState<BuildingType>("residential");
  const [chips, setChips] = useState<string[]>(RESIDENTIAL_CHIPS);
  const [chipsTouched, setChipsTouched] = useState(false);
  const [floors, setFloors] = useState<DraftFloor[]>([
    { key: crypto.randomUUID(), label: "", defaults: defaultFloorDefaults() },
  ]);
  const [saving, setSaving] = useState(false);

  function selectBuildingType(type: BuildingType) {
    setBuildingType(type);
    if (!chipsTouched) {
      setChips(type === "residential" ? RESIDENTIAL_CHIPS : COMMERCIAL_CHIPS);
    }
  }

  function addFloor() {
    setFloors((fs) => [...fs, { key: crypto.randomUUID(), label: "", defaults: defaultFloorDefaults() }]);
  }
  function updateFloor(key: string, patch: Partial<DraftFloor>) {
    setFloors((fs) => fs.map((f) => (f.key === key ? { ...f, ...patch } : f)));
  }
  function removeFloor(key: string) {
    setFloors((fs) => fs.filter((f) => f.key !== key));
  }

  const canSave =
    name.trim().length > 0 && floors.length > 0 && floors.every((f) => f.label.trim().length > 0);

  async function handleSave() {
    if (!canSave || saving) return;
    setSaving(true);
    try {
      const project = await createProject({
        name: name.trim(),
        address: address.trim(),
        building_type: buildingType,
        tag_chips: chips,
      });
      for (const f of floors) {
        await createFloor({ project_id: project.id, label: f.label.trim(), defaults: f.defaults });
      }
      router.push(`/project/${project.id}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="flex flex-1 flex-col gap-6 p-4 pb-28">
      <header className="flex items-center gap-3">
        <button type="button" onClick={() => router.back()} className="min-h-11 min-w-11 text-xl">
          ←
        </button>
        <h1 className="text-xl font-semibold">New job</h1>
      </header>

      <div className="flex flex-col gap-4">
        <div>
          <label className="mb-1 block text-sm text-neutral-500">Name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Arbour House 15 Neighborhood Lane"
            className="min-h-12 w-full rounded-lg border border-neutral-300 px-3 dark:border-neutral-700 dark:bg-neutral-900"
          />
        </div>
        <div>
          <label className="mb-1 block text-sm text-neutral-500">Address</label>
          <input
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="15 Neighborhood Lane"
            className="min-h-12 w-full rounded-lg border border-neutral-300 px-3 dark:border-neutral-700 dark:bg-neutral-900"
          />
        </div>

        <div>
          <div className="mb-1 text-sm text-neutral-500">Building type</div>
          <div className="flex overflow-hidden rounded-lg border border-neutral-300 dark:border-neutral-700">
            {(["residential", "commercial"] as const).map((type) => (
              <button
                key={type}
                type="button"
                onClick={() => selectBuildingType(type)}
                aria-pressed={buildingType === type}
                className={`min-h-12 flex-1 px-2 text-sm font-medium ${
                  buildingType === type
                    ? "bg-blue-600 text-white"
                    : "bg-white text-neutral-700 dark:bg-neutral-900 dark:text-neutral-300"
                }`}
              >
                {type === "residential" ? "Multi-unit residential" : "Office / commercial"}
              </button>
            ))}
          </div>
        </div>

        <div>
          <div className="mb-1 text-sm text-neutral-500">Room tags</div>
          <TagChipEditor
            chips={chips}
            onChange={(c) => {
              setChips(c);
              setChipsTouched(true);
            }}
          />
        </div>
      </div>

      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-neutral-500">Floors / batches</h2>
          <button
            type="button"
            onClick={addFloor}
            className="min-h-9 rounded-lg bg-neutral-100 px-3 text-sm font-medium dark:bg-neutral-800"
          >
            + Add floor
          </button>
        </div>

        {floors.map((f, i) => (
          <div key={f.key} className="rounded-xl border border-neutral-200 p-4 dark:border-neutral-800">
            <div className="mb-3 flex items-center gap-2">
              <input
                value={f.label}
                onChange={(e) => updateFloor(f.key, { label: e.target.value })}
                placeholder={`Level 4 or Batch ${i + 1}`}
                className="min-h-11 flex-1 rounded-lg border border-neutral-300 px-3 font-medium dark:border-neutral-700 dark:bg-neutral-900"
              />
              {floors.length > 1 && (
                <button
                  type="button"
                  onClick={() => removeFloor(f.key)}
                  className="min-h-11 min-w-11 text-sm text-red-600"
                >
                  Remove
                </button>
              )}
            </div>
            <FloorDefaultsForm value={f.defaults} onChange={(defaults) => updateFloor(f.key, { defaults })} />
          </div>
        ))}
      </div>

      <div className="fixed inset-x-0 bottom-0 border-t border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-950">
        <button
          type="button"
          onClick={handleSave}
          disabled={!canSave || saving}
          className="min-h-14 w-full rounded-xl bg-blue-600 text-base font-semibold text-white disabled:opacity-50"
        >
          {saving ? "Creating…" : "Create job"}
        </button>
      </div>
    </main>
  );
}
