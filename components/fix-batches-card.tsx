"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  createFixBatch,
  listFixBatches,
  listInvoices,
  listProjectFixItems,
  loadFixGather,
} from "@/lib/db";
import { billedInvoiceIds, blindCount, fixCounts, gatherFixItems, inBatchIds, type GatherFloor } from "@/lib/fixes";
import { triggerSyncIfAvailable } from "@/components/trigger-sync";
import type { FixBatch, FixItem, Floor, InvoiceRecord } from "@/lib/types";
import { useRemoteVersion } from "@/lib/sync-events";

const REMOTE_TABLES = ["fix_batches", "fix_items", "floors", "units", "windows", "deficiencies", "invoices"] as const;

interface FloorOption {
  floor: Floor;
  gather: GatherFloor;
}

/**
 * The job page's way into deficiency batches: what is running, and a picker
 * to start one from the floors with open deficiencies on their blinds.
 *
 * Hidden entirely on a job with no deficiencies and no batches — a crew that
 * only measures never needs to see it.
 */
export function FixBatchesCard({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [batches, setBatches] = useState<FixBatch[]>([]);
  const [items, setItems] = useState<FixItem[]>([]);
  const [invoices, setInvoices] = useState<InvoiceRecord[]>([]);
  const [floors, setFloors] = useState<FloorOption[] | null>(null);
  const [picking, setPicking] = useState(false);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [name, setName] = useState("");
  const [nameTouched, setNameTouched] = useState(false);
  const [creating, setCreating] = useState(false);
  const remote = useRemoteVersion(REMOTE_TABLES);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [bs, its, fs, invs] = await Promise.all([
        listFixBatches(projectId),
        listProjectFixItems(projectId),
        loadFixGather(projectId),
        listInvoices(projectId),
      ]);
      if (cancelled) return;
      setBatches(bs);
      setItems(its);
      setInvoices(invs);
      setFloors(fs);
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, remote]);

  if (!floors) return null;
  // A deficiency still waiting in a batch is not gathered twice. A fixed one
  // is closed, so anything raised on that blind since is a new deficiency.
  const inBatch = inBatchIds(items);
  const options = floors.map((f) => ({ ...f, toFix: gatherFixItems([f.gather], inBatch).length }));
  const openFloors = options.filter((f) => f.toFix > 0);
  if (batches.length === 0 && openFloors.length === 0) return null;
  const openTotal = openFloors.reduce((n, f) => n + f.toFix, 0);
  const liveInvoiceIds = new Set(invoices.map((i) => i.id));
  const invoiceNumber = (id: string) => invoices.find((i) => i.id === id)?.number || "invoice";

  const chosenFloors = options.filter((f) => chosen.has(f.floor.id));
  // What Start will gather, so its button can say how much that is: the
  // deficiencies, and how many blinds they are on (a blind can carry two).
  const chosenSeeds = gatherFixItems(chosenFloors.map((f) => f.gather), inBatch);
  const chosenCount = chosenSeeds.length;
  const chosenBlinds = blindCount(chosenSeeds);
  const suggestedName = chosenFloors.length
    ? `${chosenFloors.map((f) => f.floor.label).join(" + ")} fixes`
    : "";
  const batchName = nameTouched ? name : suggestedName;

  function toggleFloor(id: string) {
    setChosen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleStart() {
    if (chosenCount === 0 || creating) return;
    setCreating(true);
    try {
      const seeds = chosenSeeds;
      const batch = await createFixBatch(
        {
          project_id: projectId,
          name: batchName.trim() || suggestedName,
          floor_ids: chosenFloors.map((f) => f.floor.id),
          // Carry the last batch's rate: the same crew charges the same for
          // a fix on the next round.
          rate_cents: batches[0]?.rate_cents ?? null,
        },
        seeds
      );
      triggerSyncIfAvailable();
      router.push(`/project/${projectId}/fixes/${batch.id}`);
    } finally {
      setCreating(false);
    }
  }

  return (
    <section>
      <h2 className="mb-2 text-sm font-semibold text-neutral-500">Deficiency batches</h2>
      <div className="flex flex-col gap-2">
        {batches.map((b) => {
          const its = items.filter((i) => i.batch_id === b.id);
          const c = fixCounts(its);
          const done = c.open === 0 && c.total > 0;
          const billed = billedInvoiceIds(its, liveInvoiceIds).map(invoiceNumber);
          return (
            <Link
              key={b.id}
              href={`/project/${projectId}/fixes/${b.id}`}
              className="flex min-h-14 items-center justify-between gap-3 rounded-xl border border-neutral-200 p-4 active:bg-neutral-50 dark:border-neutral-800 dark:active:bg-neutral-900"
            >
              <span className="min-w-0 truncate font-medium">{b.name}</span>
              <span className={`shrink-0 text-sm ${done ? "text-emerald-600" : "text-neutral-500"}`}>
                {c.fixed}/{c.total} fixed
                {billed.length > 0 && ` · billed ${billed.join(", ")}`}
              </span>
            </Link>
          );
        })}

        {picking ? (
          <div className="flex flex-col gap-3 rounded-xl border border-neutral-200 p-4 dark:border-neutral-800">
            <div className="text-sm text-neutral-600 dark:text-neutral-300">
              Which floors are you fixing? Every open deficiency on their blinds goes in the batch.
            </div>
            <div className="flex flex-col gap-1">
              {options.map(({ floor, toFix }) => (
                <label
                  key={floor.id}
                  className={`flex min-h-12 items-center gap-3 rounded-lg px-2 ${toFix === 0 ? "opacity-40" : ""}`}
                >
                  <input
                    type="checkbox"
                    className="h-5 w-5"
                    disabled={toFix === 0}
                    checked={chosen.has(floor.id)}
                    onChange={() => toggleFloor(floor.id)}
                  />
                  <span className="flex-1">
                    <span className="font-medium">{floor.label}</span>
                    <span className="text-sm text-neutral-500"> · {toFix === 0 ? "nothing to fix" : `${toFix} to fix`}</span>
                  </span>
                </label>
              ))}
            </div>
            <label>
              <span className="mb-1 block text-sm text-neutral-500">Batch name</span>
              <input
                value={batchName}
                onChange={(e) => {
                  setNameTouched(true);
                  setName(e.target.value);
                }}
                placeholder="Batch 4 fixes"
                className="min-h-11 w-full rounded-lg border border-neutral-300 px-3 dark:border-neutral-700 dark:bg-neutral-900"
              />
            </label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => void handleStart()}
                disabled={chosenCount === 0 || creating}
                className="min-h-12 flex-1 rounded-lg bg-blue-600 px-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                {creating
                  ? "Starting…"
                  : chosenCount === 0
                    ? "Pick a floor"
                    : `Start — ${chosenCount} ${chosenCount === 1 ? "deficiency" : "deficiencies"} on ${chosenBlinds} ${
                        chosenBlinds === 1 ? "blind" : "blinds"
                      }`}
              </button>
              <button
                type="button"
                onClick={() => setPicking(false)}
                className="min-h-12 rounded-lg bg-neutral-100 px-4 text-sm dark:bg-neutral-800"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          openFloors.length > 0 && (
            <button
              type="button"
              onClick={() => {
                // One floor with deficiencies is the usual case: pre-tick it.
                if (openFloors.length === 1) setChosen(new Set([openFloors[0].floor.id]));
                setPicking(true);
              }}
              className="min-h-11 w-full rounded-lg bg-neutral-100 text-sm font-medium dark:bg-neutral-800"
            >
              + Start a deficiency batch — {openTotal} open
            </button>
          )
        )}
      </div>
    </section>
  );
}
