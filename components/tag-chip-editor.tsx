"use client";

import { useState } from "react";

interface TagChipEditorProps {
  chips: string[];
  onChange: (chips: string[]) => void;
}

/** Add/remove pills for a project's room-tag chip set (see spec: New job wizard — "Chip set is editable per project"). */
export function TagChipEditor({ chips, onChange }: TagChipEditorProps) {
  const [draft, setDraft] = useState("");

  function addChip() {
    const value = draft.trim();
    if (!value || chips.includes(value)) {
      setDraft("");
      return;
    }
    onChange([...chips, value]);
    setDraft("");
  }

  function removeChip(chip: string) {
    onChange(chips.filter((c) => c !== chip));
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        {chips.map((chip) => (
          <span
            key={chip}
            className="flex items-center gap-1 rounded-full bg-neutral-100 py-1.5 pl-3 pr-1.5 text-sm dark:bg-neutral-800"
          >
            {chip}
            <button
              type="button"
              onClick={() => removeChip(chip)}
              aria-label={`Remove ${chip}`}
              className="flex min-h-8 min-w-8 items-center justify-center text-base text-neutral-400 active:text-neutral-700 dark:active:text-neutral-200"
            >
              ×
            </button>
          </span>
        ))}
      </div>
      <div className="flex gap-2">
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addChip();
            }
          }}
          placeholder="Add tag (e.g. Den)"
          className="min-h-11 flex-1 rounded-lg border border-neutral-300 px-3 text-sm dark:border-neutral-700 dark:bg-neutral-900"
        />
        <button
          type="button"
          onClick={addChip}
          className="min-h-11 rounded-lg bg-neutral-800 px-4 text-sm font-medium text-white dark:bg-neutral-100 dark:text-neutral-900"
        >
          Add
        </button>
      </div>
    </div>
  );
}
