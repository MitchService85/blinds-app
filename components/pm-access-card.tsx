"use client";

import { useEffect, useState } from "react";
import { createProjectShare, listProjectShares, revokeProjectShare } from "@/lib/db";
import { pmShareUrl } from "@/lib/pm";
import { triggerSyncIfAvailable } from "@/components/trigger-sync";
import type { ProjectShare } from "@/lib/types";

/**
 * The project hub's "Project manager access" card: hand out and revoke the
 * per-project links an external PM uses (see the PM view spec). The link is
 * the whole authorisation, so it is shown in full and re-copyable, and
 * revoking is one tap.
 */
export function PmAccessCard({ projectId }: { projectId: string }) {
  const [shares, setShares] = useState<ProjectShare[]>([]);
  const [label, setLabel] = useState("");
  const [adding, setAdding] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void listProjectShares(projectId).then((rows) => {
      if (!cancelled) setShares(rows);
    });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  async function refresh() {
    setShares(await listProjectShares(projectId));
  }

  async function handleCreate() {
    const name = label.trim();
    if (!name) return;
    await createProjectShare(projectId, name);
    setLabel("");
    setAdding(false);
    await refresh();
    triggerSyncIfAvailable();
  }

  async function handleRevoke(id: string) {
    if (!confirm("Revoke this link? The PM loses access on their next visit.")) return;
    await revokeProjectShare(id);
    await refresh();
    triggerSyncIfAvailable();
  }

  async function handleShare(share: ProjectShare) {
    const url = pmShareUrl(share.token, window.location.origin);
    const nav = navigator as Navigator & { share?: (d: { url: string; title?: string }) => Promise<void> };
    if (nav.share) {
      try {
        await nav.share({ url, title: "Install progress" });
        return;
      } catch {
        // cancelled — fall through to copy
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      setCopied(share.id);
      window.setTimeout(() => setCopied(null), 1500);
    } catch {
      prompt("Copy this link", url);
    }
  }

  const active = shares.filter((s) => !s.revoked_at);
  const revoked = shares.filter((s) => s.revoked_at);

  return (
    <section>
      <div className="mb-2 flex items-baseline justify-between">
        <h2 className="text-sm font-semibold text-neutral-500">Project manager access</h2>
        <span className="text-xs text-neutral-500">progress + deficiencies only</span>
      </div>
      <div className="flex flex-col gap-2">
        {active.map((s) => (
          <div
            key={s.id}
            className="flex items-center gap-2 rounded-xl border border-neutral-200 p-3 dark:border-neutral-800"
          >
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium">{s.label || "PM link"}</div>
              <div className="text-xs text-neutral-500">
                {s.last_used_at
                  ? `Last opened ${new Date(s.last_used_at).toLocaleDateString()}`
                  : "Not opened yet"}
              </div>
            </div>
            <button
              type="button"
              onClick={() => void handleShare(s)}
              className="min-h-9 shrink-0 rounded-lg bg-blue-600 px-3 text-xs font-semibold text-white"
            >
              {copied === s.id ? "Copied" : "Share link"}
            </button>
            <button
              type="button"
              onClick={() => void handleRevoke(s.id)}
              className="min-h-9 shrink-0 rounded-lg bg-neutral-100 px-2.5 text-xs font-medium dark:bg-neutral-800"
            >
              Revoke
            </button>
          </div>
        ))}
        {revoked.length > 0 && (
          <div className="text-xs text-neutral-500">
            {revoked.length} revoked link{revoked.length === 1 ? "" : "s"}
          </div>
        )}

        {adding ? (
          <div className="rounded-xl border border-neutral-200 p-3 dark:border-neutral-800">
            <label className="mb-1 block text-sm text-neutral-500">Who is this link for?</label>
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void handleCreate();
              }}
              enterKeyHint="done"
              placeholder="e.g. Site PM, Property manager"
              autoFocus
              className="min-h-11 w-full rounded-lg border border-neutral-300 px-3 text-sm dark:border-neutral-700 dark:bg-neutral-900"
            />
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                onClick={() => void handleCreate()}
                disabled={!label.trim()}
                className="min-h-11 flex-1 rounded-lg bg-blue-600 text-sm font-semibold text-white disabled:opacity-50"
              >
                Create link
              </button>
              <button
                type="button"
                onClick={() => setAdding(false)}
                className="min-h-11 rounded-lg bg-neutral-100 px-4 text-sm dark:bg-neutral-800"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="min-h-11 w-full rounded-lg bg-neutral-100 text-sm font-medium dark:bg-neutral-800"
          >
            + Give a PM access
          </button>
        )}
        <div className="text-xs text-neutral-500">
          They see which units are installed and can flag a deficiency on a unit or a blind. No
          sizes, notes or pricing.
        </div>
      </div>
    </section>
  );
}
