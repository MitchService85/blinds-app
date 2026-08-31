"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  getCompany,
  inviteMember,
  listMembers,
  removeMember,
  setMemberRole,
  updateCompany,
} from "@/lib/db";
import { compressImage } from "@/lib/photos";
import { triggerSyncIfAvailable } from "@/components/trigger-sync";
import type { Company, Membership } from "@/lib/types";

/**
 * Company settings and the team roster.
 *
 * Branding here is stored for quoting to print later — a quote goes out under
 * the company's name, not the app's. Everything writes through lib/db.ts, so
 * edits are durable offline and sync like any other row; the server rejects
 * anything a non-admin tries, so this screen hides admin controls for
 * members rather than pretending they will work.
 */
export default function CompanyPage() {
  const [company, setCompany] = useState<Company | null>(null);
  const [members, setMembers] = useState<Membership[]>([]);
  const [loading, setLoading] = useState(true);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);

  const refresh = useCallback(async () => {
    const [c, m] = await Promise.all([getCompany(), listMembers()]);
    setCompany(c ?? null);
    setMembers(m);
    setLoading(false);
  }, []);

  useEffect(() => {
    // Load in an async callback rather than the effect body: setting state
    // synchronously inside an effect cascades renders (the same rule the
    // export-history hook follows).
    let cancelled = false;
    void (async () => {
      const [c, m] = await Promise.all([getCompany(), listMembers()]);
      if (cancelled) return;
      setCompany(c ?? null);
      setMembers(m);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * Patch a branding field. State updates synchronously and the write follows:
   * awaiting the DB round-trip per keystroke made the caret lag and iOS
   * autocorrect lose the word it was fixing (field report, 2026-08-27).
   */
  function patch(next: Partial<Company>) {
    setCompany((c) => (c ? { ...c, ...next } : c));
    void updateCompany(next).then(() => {
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 1200);
      triggerSyncIfAvailable();
    });
  }

  async function handleLogo(file: File) {
    // Same compression as unit photos: inline data URL, no blob storage to
    // fail in a dead zone.
    patch({ logo: await compressImage(file) });
  }

  async function handleInvite() {
    const email = inviteEmail.trim().toLowerCase();
    setInviteError(null);
    if (!email || !email.includes("@")) {
      setInviteError("Enter an email address.");
      return;
    }
    if (members.some((m) => m.email === email)) {
      setInviteError("That address is already on the team.");
      return;
    }
    await inviteMember(email);
    setInviteEmail("");
    await refresh();
    triggerSyncIfAvailable();
  }

  if (loading) {
    return <main className="p-4 text-sm text-neutral-500">Loading…</main>;
  }

  if (!company) {
    return (
      <main className="flex flex-col gap-3 p-4">
        <Link href="/" className="text-sm text-blue-600">
          ← Back
        </Link>
        <p className="text-sm text-neutral-500">
          No company on this device yet. Sign in to sync and it will appear here.
        </p>
      </main>
    );
  }

  return (
    <main className="flex flex-1 flex-col gap-5 p-4 pb-24">
      <header className="safe-sticky-top sticky z-20 -mx-4 flex items-center gap-3 bg-white/95 px-4 pb-3 backdrop-blur dark:bg-neutral-950/95">
        <Link href="/" className="min-h-11 min-w-11 shrink-0 text-xl leading-[2.75rem]">
          ←
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-semibold break-words">{company.name || "Your company"}</h1>
          <div className="text-sm text-neutral-500">Company settings</div>
        </div>
        {savedFlash && (
          <span className="shrink-0 text-xs text-emerald-600 dark:text-emerald-400">✓ saved</span>
        )}
      </header>

      <section className="flex flex-col gap-3">
        <div>
          <label className="mb-1 block text-sm text-neutral-500" htmlFor="company-name">
            Company name
          </label>
          <input
            id="company-name"
            type="text"
            value={company.name}
            onChange={(e) => patch({ name: e.target.value })}
            className="min-h-11 w-full rounded-lg border border-neutral-300 px-3 text-sm dark:border-neutral-700 dark:bg-neutral-900"
          />
        </div>

        <div>
          <div className="mb-1 text-sm text-neutral-500">
            Logo <span className="text-neutral-400">(printed on quotes)</span>
          </div>
          <div className="flex items-center gap-3">
            {company.logo ? (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={company.logo}
                  alt="Company logo"
                  className="h-16 w-16 rounded-lg border border-neutral-300 object-contain dark:border-neutral-700"
                />
                <button
                  type="button"
                  onClick={() => patch({ logo: "" })}
                  className="min-h-9 rounded-lg bg-neutral-100 px-3 text-xs font-medium dark:bg-neutral-800"
                >
                  Remove
                </button>
              </>
            ) : (
              <label className="flex h-16 w-16 cursor-pointer items-center justify-center rounded-lg border border-dashed border-neutral-300 text-2xl text-neutral-500 dark:border-neutral-700">
                +
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void handleLogo(f);
                  }}
                />
              </label>
            )}
          </div>
        </div>

        <div>
          <label className="mb-1 block text-sm text-neutral-500" htmlFor="quote-footer">
            Quote footer <span className="text-neutral-400">(optional)</span>
          </label>
          <textarea
            id="quote-footer"
            value={company.quote_footer}
            onChange={(e) => patch({ quote_footer: e.target.value })}
            placeholder="e.g. Prices valid 30 days. HST extra."
            rows={2}
            className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900"
          />
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold text-neutral-500">Team</h2>

        {members.map((m) => (
          <div
            key={m.id}
            className="flex items-center gap-2 rounded-lg border border-neutral-200 p-3 dark:border-neutral-800"
          >
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">{m.email}</div>
              <div className="text-xs text-neutral-500">
                {m.role === "admin" ? "Admin" : "Member"}
                {m.status === "invited" && " · invited, not signed in yet"}
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                void setMemberRole(m.id, m.role === "admin" ? "member" : "admin").then(refresh);
              }}
              className="min-h-9 shrink-0 rounded-lg bg-neutral-100 px-2.5 text-xs font-medium dark:bg-neutral-800"
            >
              {m.role === "admin" ? "Make member" : "Make admin"}
            </button>
            <button
              type="button"
              onClick={() => {
                if (
                  window.confirm(
                    `Remove ${m.email}? They lose access immediately, and their measurements stay with the company.`
                  )
                ) {
                  void removeMember(m.id).then(refresh);
                }
              }}
              className="min-h-9 shrink-0 rounded-lg bg-red-50 px-2.5 text-xs font-medium text-red-700 dark:bg-red-950 dark:text-red-300"
            >
              Remove
            </button>
          </div>
        ))}

        <div className="mt-1 flex flex-col gap-2 rounded-lg border border-dashed border-neutral-300 p-3 dark:border-neutral-700">
          <label className="text-xs text-neutral-500" htmlFor="invite-email">
            Invite someone by email. They join when they first sign in.
          </label>
          <div className="flex gap-2">
            <input
              id="invite-email"
              type="email"
              inputMode="email"
              autoCapitalize="none"
              autoCorrect="off"
              value={inviteEmail}
              onChange={(e) => {
                setInviteEmail(e.target.value);
                setInviteError(null);
              }}
              placeholder="name@company.com"
              className="min-h-11 flex-1 rounded-lg border border-neutral-300 px-3 text-sm dark:border-neutral-700 dark:bg-neutral-900"
            />
            <button
              type="button"
              onClick={() => void handleInvite()}
              className="min-h-11 shrink-0 rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white"
            >
              Invite
            </button>
          </div>
          {inviteError && <div className="text-xs text-red-600">{inviteError}</div>}
        </div>
      </section>
    </main>
  );
}
