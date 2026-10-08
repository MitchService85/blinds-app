"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { Icon } from "@/components/icon";
import { WELCOME_DISMISSED_KEY } from "@/lib/guide";
import { writePref } from "@/lib/local-pref";

const subscribeNever = () => () => {};
const getBody = () => document.body;
const getNoBody = () => null;

/**
 * First-run welcome: what the app is for, in three lines, and the way into
 * the tour (2026-10-08: "for a new user, a popup appears with a button to the
 * guide"). Shown by the dashboard only on a phone that holds nothing but the
 * sample job, and only until it is answered once, by any button.
 *
 * Portalled into <body>, out of the page: a full-screen overlay nested in
 * <main> is exactly the kind of fixed element WebKit has mis-anchored here
 * before (see components/viewport-layer.tsx).
 */
export function WelcomeSheet({ onClose }: { onClose: () => void }) {
  const host = useSyncExternalStore(subscribeNever, getBody, getNoBody);
  if (!host) return null;

  const dismiss = () => {
    writePref(WELCOME_DISMISSED_KEY, "1");
    onClose();
  };

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-3 sm:items-center">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="welcome-title"
        className="flex w-full max-w-md flex-col gap-4 rounded-2xl bg-white p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-xl dark:bg-neutral-900"
      >
        <div>
          <h2 id="welcome-title" className="text-2xl font-semibold">
            Welcome to Measure
          </h2>
          <p className="mt-1 text-sm text-neutral-500">Blinds, from the first measurement to the last install.</p>
        </div>
        <ul className="flex flex-col gap-3 text-base">
          <li className="flex items-start gap-3">
            <span aria-hidden className="text-xl">📏</span>
            <span>Measure every window on your phone — it works with no signal.</span>
          </li>
          <li className="flex items-start gap-3">
            <span aria-hidden className="text-xl">📄</span>
            <span>Send the factory its spreadsheet straight from the floor.</span>
          </li>
          <li className="flex items-start gap-3">
            <span aria-hidden className="text-xl">✅</span>
            <span>Track installs unit by unit, with the whole crew.</span>
          </li>
        </ul>
        <div className="flex flex-col gap-2">
          <Link
            href="/help/tour"
            onClick={dismiss}
            className="flex min-h-14 items-center justify-center gap-2 rounded-xl bg-blue-600 text-base font-semibold text-white active:bg-blue-700"
          >
            Take the 5-minute tour
          </Link>
          <Link
            href="/project/demo-project-0001"
            onClick={dismiss}
            className="flex min-h-12 items-center justify-center rounded-xl border border-neutral-300 font-semibold active:bg-neutral-100 dark:border-neutral-700 dark:active:bg-neutral-800"
          >
            Look around the sample job
          </Link>
          <button type="button" onClick={dismiss} className="min-h-11 text-sm font-medium text-neutral-500">
            Not now
          </button>
        </div>
        <p className="flex items-start justify-center gap-1.5 text-xs text-neutral-500">
          <Icon name="help" size={14} className="mt-px shrink-0" />
          <span>
            The guide is always one tap away: <b>Guide</b>, at the top of the home screen.
          </span>
        </p>
      </div>
    </div>,
    host
  );
}
