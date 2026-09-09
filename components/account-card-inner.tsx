"use client";

import { useState } from "react";
import { useSyncStatus } from "@/lib/sync";

const STATE_LINE: Record<string, string> = {
  "local-only": "This build doesn't sync — measurements stay on this phone.",
  synced: "Everything is uploaded.",
  offline: "No signal. Everything is saved here and goes up when you're back.",
  error: "Something is stopping the upload.",
};

/**
 * The account panel on Settings.
 *
 * Sign out already existed, but only behind the small grey status text in the
 * home header — which reads as a label, not a button, so in practice nobody
 * could find it (field report, 2026-09-09, while trying to follow a sync
 * error that literally said "sign out and back in"). This is where anyone
 * would actually look, and it names the account too: when two phones sync to
 * different places, "signed in as who?" is the first question.
 *
 * Loaded only via the dynamic import in account-card.tsx, so a build without
 * lib/sync/ never resolves this module's static import.
 */
/**
 * What to ask before signing out.
 *
 * Signing out with work still queued destroys it: the outbox lives in this
 * browser and those rows have never reached the server. A day of measurements
 * is not worth a generic "are you sure", so the count and the way out ("Sync
 * now") go in the question.
 */
export function signOutWarning(pendingCount: number): string {
  if (pendingCount <= 0) return "Sign out of this phone?";
  const [subject, object] =
    pendingCount === 1 ? ["change has", "it"] : ["changes have", "them"];
  return (
    `${pendingCount} ${subject} not uploaded yet. Signing out now loses ${object} ` +
    `for good — try "Sync now" first, and check it says everything is uploaded. Sign out anyway?`
  );
}

export function AccountCardInner() {
  const status = useSyncStatus();
  const [busy, setBusy] = useState(false);

  const line =
    status.state === "pending"
      ? `${status.pendingCount} change${status.pendingCount === 1 ? "" : "s"} still to upload.`
      : (STATE_LINE[status.state] ?? status.state);

  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-sm font-semibold text-neutral-500">This phone</h2>
      <div className="flex flex-col gap-3 rounded-xl border border-neutral-200 p-4 dark:border-neutral-800">
        <div>
          <div className="text-sm font-medium break-all">
            {status.signedIn ? (status.email ?? "Signed in") : "Not signed in"}
          </div>
          <div className="mt-0.5 text-xs text-neutral-500">{line}</div>
        </div>

        {status.errorDetail && (
          <p className="rounded-lg border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">
            {status.errorDetail}
          </p>
        )}

        {status.signedIn ? (
          <div className="flex gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                await status.syncNow();
                setBusy(false);
              }}
              className="min-h-11 flex-1 rounded-lg bg-blue-600 text-sm font-semibold text-white disabled:opacity-50"
            >
              {busy ? "Syncing…" : "Sync now"}
            </button>
            <button
              type="button"
              onClick={() => {
                if (window.confirm(signOutWarning(status.pendingCount))) void status.signOut();
              }}
              className="min-h-11 rounded-lg bg-neutral-100 px-4 text-sm font-medium dark:bg-neutral-800"
            >
              Sign out
            </button>
          </div>
        ) : (
          <p className="text-xs text-neutral-500">
            Tap the status at the top of the home screen to sign in.
          </p>
        )}
      </div>
    </section>
  );
}
