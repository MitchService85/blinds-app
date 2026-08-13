"use client";

import { useState } from "react";
import { useSyncStatus } from "@/lib/sync";

const STATE_LABEL: Record<string, string> = {
  "local-only": "local only",
  synced: "✓ synced",
  offline: "offline — will sync",
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
    : "sign in to sync";

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
    setMessage(
      "Check your email. Long-press the sign-in link, Copy Link, and paste it below. (Ignore that the link itself opens a broken page.)"
    );
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
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-xs text-neutral-500 underline-offset-2 hover:underline dark:text-neutral-400"
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
                <p className="mb-4 text-sm text-neutral-500">
                  Signed in. {status.pendingCount} change
                  {status.pendingCount === 1 ? "" : "s"} waiting to upload.
                </p>
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
                  <input
                    type="text"
                    autoComplete="one-time-code"
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    placeholder="Paste link, or 6-digit code"
                    className="mb-2 min-h-12 w-full rounded-lg border border-neutral-300 px-3 dark:border-neutral-700 dark:bg-neutral-900"
                  />
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
                  {busy ? "…" : sent ? "Sign in" : "Email me a sign-in link"}
                </button>
                {sent && (
                  <button
                    type="button"
                    onClick={sendCode}
                    className="mt-2 min-h-10 w-full text-xs text-neutral-500"
                  >
                    Send another email
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
