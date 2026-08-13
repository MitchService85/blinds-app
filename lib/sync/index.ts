"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";
import {
  createClient,
  type Session,
  type SupabaseClient,
} from "@supabase/supabase-js";
import type { Table } from "dexie";
import { db, type OutboxTableName } from "../db";
import type { SyncedRow } from "../types";

/**
 * Sync engine over lib/db.ts's outbox (see spec: Autosave and sync).
 *
 * Design:
 * - The UI never touches this module's internals directly except through
 *   `useSyncStatus()` and `forceSync()` (wired to "Save & exit").
 * - Every local write already lands in IndexedDB durably via lib/db.ts, so
 *   this module's only job is pushing the outbox to Supabase and pulling
 *   remote changes back in, without going through lib/db.ts's outbox-writing
 *   path (that would create sync loops).
 * - When NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY are not
 *   set (e.g. this build, or a dev machine with no Supabase project yet),
 *   `supabase` below is null and every exported function becomes a no-op.
 *   `useSyncStatus()` reports `state: "local-only"` in that case. This is
 *   the "wire-ready but inert without env vars" requirement.
 *
 * Conflict resolution (last-write-wins on `updated_at`):
 * Rather than a Postgres-side conditional upsert (RPC / trigger), this
 * pushes with a plain client-side LWW check: before upserting a batch, it
 * selects `id, updated_at` for those rows from Supabase and only includes
 * rows whose local `updated_at` is strictly newer than the server's (or
 * that don't exist server-side yet) in the upsert. Rows that lose the
 * comparison still have their outbox entries cleared — the authoritative
 * (newer) server copy will arrive on the next `pullSince()` instead. This
 * keeps the write path a single plain `upsert()` call (no stored
 * procedures to deploy/maintain) at the cost of one extra round-trip
 * `select` per batch, which is a non-issue at this app's scale (two users,
 * one job site at a time — see spec: "collisions are rare and low-stakes").
 */

// ---------------------------------------------------------------------------
// Client (guarded)
// ---------------------------------------------------------------------------

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const isBrowser = () => typeof window !== "undefined";

/** Tables live in the `blinds` schema (see createClient below). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type BlindsClient = SupabaseClient<any, "blinds">;

const supabase: BlindsClient | null =
  SUPABASE_URL && SUPABASE_ANON_KEY
    ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        // The app's tables live in a dedicated `blinds` schema, not `public`:
        // the Supabase org is at its free-project cap, so this database is
        // shared with HyperFocus (which owns `public`). See
        // supabase/migrations/001_init.sql.
        db: { schema: "blinds" },
        auth: {
          persistSession: isBrowser(),
          autoRefreshToken: isBrowser(),
          detectSessionInUrl: isBrowser(),
        },
      })
    : null;

/** True when this build has Supabase env vars — i.e. sync can ever run. */
export function isSyncConfigured(): boolean {
  return supabase !== null;
}

// ---------------------------------------------------------------------------
// Local table access (raw Dexie writes, bypassing lib/db.ts's outbox path)
// ---------------------------------------------------------------------------

const TABLES: OutboxTableName[] = ["projects", "floors", "units", "windows"];

function getLocalTable(table: OutboxTableName): Table<SyncedRow, string> {
  switch (table) {
    case "projects":
      return db.projects as unknown as Table<SyncedRow, string>;
    case "floors":
      return db.floors as unknown as Table<SyncedRow, string>;
    case "units":
      return db.units as unknown as Table<SyncedRow, string>;
    case "windows":
      return db.windows as unknown as Table<SyncedRow, string>;
  }
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------

let currentSession: Session | null = null;

async function getSession(): Promise<Session | null> {
  if (!supabase) return null;
  if (currentSession) return currentSession;
  const { data } = await supabase.auth.getSession();
  currentSession = data.session ?? null;
  return currentSession;
}

// ---------------------------------------------------------------------------
// Backoff
// ---------------------------------------------------------------------------

const BASE_BACKOFF_MS = 2_000;
const MAX_BACKOFF_MS = 5 * 60 * 1_000;

let backoffMs = 0;
let backoffUntil = 0;

function scheduleBackoff(): void {
  // The triggering error isn't surfaced to the UI (see spec: sync failures
  // "never surface as blocking errors, only the pending count") — state
  // "error" plus the backoff window is all `useSyncStatus()` exposes.
  backoffMs = backoffMs ? Math.min(backoffMs * 2, MAX_BACKOFF_MS) : BASE_BACKOFF_MS;
  backoffUntil = Date.now() + backoffMs;
}

function resetBackoff(): void {
  backoffMs = 0;
  backoffUntil = 0;
}

// ---------------------------------------------------------------------------
// Push: drainOutbox
// ---------------------------------------------------------------------------

/**
 * Drain the local outbox to Supabase, oldest-first, batched per table.
 * No-op (resolves immediately) when sync isn't configured, when the last
 * attempt is still in its backoff window, or when there's no session yet
 * (RLS would reject anonymous writes anyway).
 */
export async function drainOutbox(): Promise<void> {
  const client = supabase;
  if (!client) return;
  if (Date.now() < backoffUntil) return;

  try {
    const session = await getSession();
    if (!session) return;

    const entries = await db.outbox.orderBy("at").toArray();
    if (entries.length === 0) {
      resetBackoff();
      return;
    }

    // Group outbox entries by table, then by rowId. Multiple edits to the
    // same row before a sync attempt collapse into one push of the row's
    // current state, but every contributing entry gets cleared together.
    const byTable = new Map<OutboxTableName, Map<string, number[]>>();
    for (const entry of entries) {
      if (entry.id === undefined) continue;
      let rowMap = byTable.get(entry.table);
      if (!rowMap) {
        rowMap = new Map();
        byTable.set(entry.table, rowMap);
      }
      const entryIds = rowMap.get(entry.rowId) ?? [];
      entryIds.push(entry.id);
      rowMap.set(entry.rowId, entryIds);
    }

    for (const [table, rowMap] of byTable) {
      for (const rowIdBatch of chunk([...rowMap.keys()], 100)) {
        await pushBatch(client, table, rowIdBatch, rowMap);
      }
    }

    resetBackoff();
  } catch {
    scheduleBackoff();
  }
}

async function pushBatch(
  client: BlindsClient,
  table: OutboxTableName,
  rowIds: string[],
  rowMap: Map<string, number[]>
): Promise<void> {
  const entryIdsToClear: number[] = [];
  for (const id of rowIds) entryIdsToClear.push(...(rowMap.get(id) ?? []));

  const localTable = getLocalTable(table);
  const localRows = await localTable.bulkGet(rowIds);
  const existing = localRows.filter((row): row is SyncedRow => row != null);

  if (existing.length === 0) {
    // Rows referenced by these outbox entries no longer exist locally
    // (shouldn't happen since deletes are soft, but stay defensive).
    await db.outbox.bulkDelete(entryIdsToClear);
    return;
  }

  const { data: serverRows, error: selectError } = await client
    .from(table)
    .select("id, updated_at")
    .in(
      "id",
      existing.map((row) => row.id)
    );
  if (selectError) throw selectError;

  const serverUpdatedAt = new Map<string, string>(
    ((serverRows ?? []) as Array<{ id: string; updated_at: string }>).map((row) => [
      row.id,
      row.updated_at,
    ])
  );

  // Last-write-wins: only push rows that are newer than (or absent from)
  // the server. ISO-8601 timestamps compare correctly as strings.
  const winners = existing.filter((row) => {
    const serverAt = serverUpdatedAt.get(row.id);
    return !serverAt || row.updated_at > serverAt;
  });

  if (winners.length > 0) {
    const { error: upsertError } = await client.from(table).upsert(winners, { onConflict: "id" });
    if (upsertError) throw upsertError;
  }

  // Entries for rows that lost the LWW comparison are cleared too — the
  // newer server row will land locally via the next pullSince().
  await db.outbox.bulkDelete(entryIdsToClear);
}

// ---------------------------------------------------------------------------
// Pull: pullSince
// ---------------------------------------------------------------------------

const PULL_PAGE_SIZE = 500;

/**
 * Fetch rows updated since each table's last-synced watermark (stored in
 * the `meta` table) and write them straight into IndexedDB — via the raw
 * Dexie tables, not lib/db.ts's helpers, so this never re-enqueues outbox
 * entries for data that just came *from* the server.
 */
export async function pullSince(): Promise<void> {
  const client = supabase;
  if (!client) return;

  try {
    const session = await getSession();
    if (!session) return;

    for (const table of TABLES) {
      await pullTable(client, table);
    }
    resetBackoff();
  } catch {
    scheduleBackoff();
  }
}

async function pullTable(client: BlindsClient, table: OutboxTableName): Promise<void> {
  const watermarkKey = `sync:watermark:${table}`;
  const stored = await db.meta.get(watermarkKey);
  let cursor = (stored?.value as string | undefined) ?? "1970-01-01T00:00:00.000Z";
  const localTable = getLocalTable(table);

  for (;;) {
    const { data, error } = await client
      .from(table)
      .select("*")
      .gt("updated_at", cursor)
      .order("updated_at", { ascending: true })
      .limit(PULL_PAGE_SIZE);
    if (error) throw error;
    if (!data || data.length === 0) break;

    const rows = data as SyncedRow[];
    await db.transaction("rw", localTable, async () => {
      for (const row of rows) {
        await localTable.put(row);
      }
    });

    cursor = rows[rows.length - 1].updated_at;
    await db.meta.put({ key: watermarkKey, value: cursor });

    if (rows.length < PULL_PAGE_SIZE) break;
  }
}

// ---------------------------------------------------------------------------
// Combined cycle
// ---------------------------------------------------------------------------

/** Push then pull once. Safe to call anytime; no-ops when unconfigured. */
export async function syncOnce(): Promise<void> {
  await drainOutbox();
  await pullSince();
  await refreshSnapshot();
}

/** Explicit "sync now" for UI actions like Save & exit (see spec). */
export const forceSync = syncOnce;

// ---------------------------------------------------------------------------
// Status store (subscribable snapshot for useSyncStatus)
// ---------------------------------------------------------------------------

export type SyncState = "local-only" | "synced" | "pending" | "offline" | "error";

interface StatusSnapshot {
  state: SyncState;
  pendingCount: number;
  signedIn: boolean;
}

let cachedSnapshot: StatusSnapshot = {
  state: supabase ? "offline" : "local-only",
  pendingCount: 0,
  signedIn: false,
};

const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

function subscribeStore(callback: () => void): () => void {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

function getSnapshot(): StatusSnapshot {
  return cachedSnapshot;
}

async function refreshSnapshot(): Promise<void> {
  if (!isBrowser()) return;

  const pendingCount = await db.outbox.count();
  const signedIn = currentSession != null;

  let state: SyncState;
  if (!supabase) {
    state = "local-only";
  } else if (!navigator.onLine) {
    state = "offline";
  } else if (Date.now() < backoffUntil) {
    state = "error";
  } else if (pendingCount > 0) {
    state = "pending";
  } else {
    state = "synced";
  }

  cachedSnapshot = { state, pendingCount, signedIn };
  notify();
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

/**
 * Email a sign-in code (and link). The emailed 6-digit code is the primary
 * path: an iOS home-screen app has its own storage container, so a magic
 * link tapped in Mail opens Safari and signs in *there*, leaving the
 * installed app still signed out. Typing the code into the app itself
 * avoids that entirely — see verifyCode below.
 */
export async function signInWithEmail(email: string): Promise<{ error: string | null }> {
  if (!supabase) return { error: "Sync isn't configured on this build." };
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      shouldCreateUser: true,
      emailRedirectTo: isBrowser() ? window.location.origin : undefined,
    },
  });
  return { error: error ? error.message : null };
}

/**
 * Finish sign-in from the email — accepts either form:
 *
 *  - the 6-digit code (needs {{ .Token }} in the Magic Link email template);
 *  - the whole magic link, pasted. The link's `token` query param is the
 *    same one-time hash, and verifying it here is a direct API call, so it
 *    works even though the link's own redirect target isn't allowlisted
 *    (it lands on localhost) — and it signs in *this* app rather than
 *    whatever browser the link would have opened.
 */
export async function verifyCode(
  email: string,
  input: string
): Promise<{ error: string | null }> {
  if (!supabase) return { error: "Sync isn't configured on this build." };
  const raw = input.trim();
  if (!raw) return { error: "Paste the link or enter the code from your email." };

  const tokenHash = extractTokenHash(raw);
  const { error } = tokenHash
    ? await supabase.auth.verifyOtp({
        token_hash: tokenHash,
        // A first-ever sign-in emails a "Confirm signup" link (type=signup);
        // later ones are type=magiclink. Trust the link's own type.
        type: extractOtpType(raw),
      })
    : await supabase.auth.verifyOtp({ email, token: raw, type: "email" });

  if (error) {
    const spent = /expired|invalid|not found/i.test(error.message);
    return {
      error: spent
        ? "That link was already used — opening it spends it. Tap \u201cSend another email\u201d, then copy the new link WITHOUT opening it."
        : error.message,
    };
  }
  void syncOnce();
  return { error: null };
}

/** The link carries its own OTP type; fall back to a plain magic link. */
function extractOtpType(input: string): "magiclink" | "signup" | "invite" | "recovery" {
  try {
    const t = new URL(input).searchParams.get("type");
    if (t === "signup" || t === "invite" || t === "recovery") return t;
  } catch {
    // not a URL — fall through
  }
  return "magiclink";
}

/**
 * Pull the one-time token out of a pasted magic link. Returns null for a
 * plain numeric code, which goes down the email-OTP path instead.
 */
export function extractTokenHash(input: string): string | null {
  if (/^\d{4,8}$/.test(input)) return null;
  try {
    const url = new URL(input);
    const fromQuery = url.searchParams.get("token") ?? url.searchParams.get("token_hash");
    if (fromQuery) return fromQuery;
    // Some templates land the tokens in the fragment instead.
    const frag = new URLSearchParams(url.hash.replace(/^#/, ""));
    return frag.get("token_hash") ?? frag.get("token");
  } catch {
    // Not a URL — treat a long opaque string as a raw token hash.
    return input.length > 8 ? input : null;
  }
}

export async function signOutUser(): Promise<void> {
  if (!supabase) return;
  await supabase.auth.signOut();
}

// ---------------------------------------------------------------------------
// Loop: start()
// ---------------------------------------------------------------------------

const SYNC_INTERVAL_MS = 60_000;
const STATUS_POLL_MS = 3_000;

let started = false;

/**
 * Wire up the sync loop: run once immediately, then on 'online', on
 * visibilitychange (tab foregrounded), and every 60s. Also polls the
 * outbox count every few seconds so `pendingCount` stays live even though
 * lib/db.ts's writers (owned by other agents' code) can't call back into
 * this module directly. Idempotent — safe to call from every mounted
 * `useSyncStatus()` consumer.
 */
export function start(): void {
  if (started || !isBrowser()) return;
  started = true;

  if (supabase) {
    supabase.auth.getSession().then(({ data }) => {
      currentSession = data.session ?? null;
      void refreshSnapshot();
    });

    supabase.auth.onAuthStateChange((_event, session) => {
      currentSession = session;
      void refreshSnapshot();
      if (session) void syncOnce();
    });

    window.addEventListener("online", () => {
      void refreshSnapshot();
      void syncOnce();
    });
    window.addEventListener("offline", () => {
      void refreshSnapshot();
    });
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") void syncOnce();
    });

    setInterval(() => void syncOnce(), SYNC_INTERVAL_MS);
    void syncOnce();
  }

  setInterval(() => void refreshSnapshot(), STATUS_POLL_MS);
  void refreshSnapshot();
}

// ---------------------------------------------------------------------------
// React hook
// ---------------------------------------------------------------------------

export interface SyncStatus {
  state: SyncState;
  pendingCount: number;
  signedIn: boolean;
  /** Email a sign-in code. Returns an error message on failure, else null. */
  signIn: (email: string) => Promise<{ error: string | null }>;
  /** Finish sign-in with the 6-digit code from that email. */
  verify: (email: string, code: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
}

/**
 * Live sync status for the UI's status indicator (see spec: "always
 * visible ... never a spinner blocking entry") and the sign-in banner.
 * Starts the sync loop on first mount.
 */
export function useSyncStatus(): SyncStatus {
  // getServerSnapshot === getSnapshot: `cachedSnapshot` is a plain module
  // constant until start() runs (client-only), so the pre-hydration value
  // is stable and matches what the server would have rendered.
  const snapshot = useSyncExternalStore(subscribeStore, getSnapshot, getSnapshot);

  useEffect(() => {
    start();
  }, []);

  const signIn = useCallback((email: string) => signInWithEmail(email), []);
  const verify = useCallback(
    (email: string, code: string) => verifyCode(email, code),
    []
  );
  const signOut = useCallback(() => signOutUser(), []);

  return {
    state: snapshot.state,
    pendingCount: snapshot.pendingCount,
    signedIn: snapshot.signedIn,
    signIn,
    verify,
    signOut,
  };
}
