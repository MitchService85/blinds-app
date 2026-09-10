"use client";

import { useState } from "react";
import { useSyncStatus } from "@/lib/sync";

// Chip labels stay short: this sits in a header beside two other chips, and
// "offline — will sync" pushed the row past the edge of a small phone. The
// full sentence lives inside the panel the chip opens.
const STATE_LABEL: Record<string, string> = {
  "local-only": "local only",
  synced: "✓ synced",
  offline: "offline",
  error: "sync error",
};

/**
 * Only ever loaded via a dynamic import from SyncStatus (see sync-status.tsx)
 * so a build without lib/sync/ never has to resolve this module's static
 * `useSyncStatus` import at all.
 */
export function SyncStatusInner() {
  const status = useSyncStatus();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const label = status.signedIn
    ? status.state === "pending"
      ? `${status.pendingCount} pending`
      : (STATE_LABEL[status.state] ?? status.state)
    : "Sign in";

  async function sendCode() {
    setBusy(true);
    setMessage(null);
    const { error } = await status.signIn(email.trim());
    setBusy(false);
    if (error) {
      setMessage(error);
      return;
    }
    setSent(true);
    setMessage(null);
  }

  async function submitCode() {
    setBusy(true);
    setMessage(null);
    const { error } = await status.verify(email.trim(), code);
    setBusy(false);
    if (error) {
      setMessage(error);
      return;
    }
    setOpen(false);
    setSent(false);
    setCode("");
  }

  return (
    <>
      {/* A chip, not bare text. This button opens the only panel with Sync
          now and Sign out in it, and as 12px grey text with a hover underline
          it read as a status label — on a phone there is no hover, so there
          was no affordance at all and the controls behind it might as well not
          have existed ("there is no sign out option", 2026-09-09). Matches
          the Settings and Help chips beside it. */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex min-h-11 items-center whitespace-nowrap rounded-full border border-neutral-300 px-3 text-xs text-neutral-600 dark:border-neutral-700 dark:text-neutral-300"
      >
        {label}
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4">
          <div className="w-full max-w-sm rounded-2xl bg-white p-4 dark:bg-neutral-900">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-base font-semibold">
                {status.signedIn ? "Sync" : "Sign in to sync"}
              </h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="min-h-9 px-2 text-sm text-neutral-500"
              >
                Close
              </button>
            </div>

            {status.signedIn ? (
              <>
                {/* Name the account: two phones syncing to different places
                    look identical from here otherwise. Settings has the same
                    panel, with the sign-out people can actually find. */}
                <p className="mb-1 text-sm font-medium break-all">
                  {status.email ?? "Signed in"}
                </p>
                <p className="mb-2 text-sm text-neutral-500">
                  {status.pendingCount === 0
                    ? "Everything is synced."
                    : `${status.pendingCount} change${
                        status.pendingCount === 1 ? "" : "s"
                      } waiting to upload.`}
                </p>
                {status.errorDetail && (
                  <p className="mb-2 rounded-lg border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">
                    Last sync problem: {status.errorDetail}
                  </p>
                )}
                <button
                  type="button"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    await status.syncNow();
                    setBusy(false);
                  }}
                  className="mb-2 min-h-12 w-full rounded-lg bg-blue-600 text-sm font-semibold text-white disabled:opacity-50"
                >
                  {busy ? "Syncing…" : "Sync now"}
                </button>
                <button
                  type="button"
                  onClick={() => status.signOut()}
                  className="min-h-12 w-full rounded-lg bg-neutral-100 text-sm font-medium dark:bg-neutral-800"
                >
                  Sign out
                </button>
              </>
            ) : (
              <>
                <p className="mb-3 text-sm text-neutral-500">
                  Your measurements stay on this phone until you sign in. Signing in
                  shares them with the rest of the crew.
                </p>
                <input
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="mb-2 min-h-12 w-full rounded-lg border border-neutral-300 px-3 dark:border-neutral-700 dark:bg-neutral-900"
                />
                {sent && (
                  <>
                    <p className="mb-2 text-sm text-neutral-500">
                      Enter the code we emailed to {email.trim()}.
                    </p>
                    <input
                      type="text"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      autoFocus
                      value={code}
                      onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 10))}
                      placeholder="Code"
                      className="mb-2 min-h-14 w-full rounded-lg border border-neutral-300 px-3 text-center text-2xl tracking-[0.3em] tabular-nums dark:border-neutral-700 dark:bg-neutral-900"
                    />
                  </>
                )}
                {message && (
                  <p className="mb-2 text-sm text-neutral-600 dark:text-neutral-300">{message}</p>
                )}
                <button
                  type="button"
                  disabled={busy || (sent ? code.trim().length < 6 : !email.includes("@"))}
                  onClick={sent ? submitCode : sendCode}
                  className="min-h-12 w-full rounded-lg bg-blue-600 text-sm font-semibold text-white disabled:opacity-50"
                >
                  {busy ? "…" : sent ? "Sign in" : "Email me a code"}
                </button>
                {sent && (
                  <button
                    type="button"
                    onClick={sendCode}
                    className="mt-2 min-h-10 w-full text-xs text-neutral-500"
                  >
                    Send a new code
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
