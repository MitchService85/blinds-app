import { describe, expect, it } from "vitest";
import {
  distinctPendingRows,
  drainOutbox,
  isPermanentError,
  isSyncConfigured,
  normalizeForPush,
  pullSince,
  pushIsUpdateOnly,
  signInWithEmail,
} from "./index";
import { setCompanyIdCache } from "../tenant";

// This test environment has no NEXT_PUBLIC_SUPABASE_URL / _ANON_KEY set (see
// package.json / CI — no .env is loaded), which is exactly the "inert"
// build configuration the spec requires: the engine must exist and
// typecheck, but every network-touching function becomes a safe no-op.
//
// syncOnce()/start()/useSyncStatus() aren't covered here: they always call
// refreshSnapshot(), which reads db.outbox via Dexie/IndexedDB — jsdom
// doesn't implement IndexedDB, and adding a fake-indexeddb devDependency
// felt like overreach for a file-scoped agent. drainOutbox()/pullSince()
// return before touching IndexedDB when unconfigured, so they're safe to
// test as-is; the composed functions are exercised manually / by the
// coordinator's browser verification pass instead.

describe("sync engine (unconfigured / local-only)", () => {
  it("reports not configured when env vars are absent", () => {
    expect(isSyncConfigured()).toBe(false);
  });

  it("drainOutbox resolves without throwing or hitting the network", async () => {
    await expect(drainOutbox()).resolves.toBeUndefined();
  });

  it("pullSince resolves without throwing or hitting the network", async () => {
    await expect(pullSince()).resolves.toBeUndefined();
  });

  it("signInWithEmail reports a clear error instead of calling Supabase", async () => {
    const { error } = await signInWithEmail("ms@mitchservice.com");
    expect(error).toBe("Sync isn't configured on this build.");
  });
});

describe("extractTokenHash", () => {
  const LINK =
    "https://lmrtferwbyqpfhomtieu.supabase.co/auth/v1/verify" +
    "?token=b7f3c1a9e2d84&type=magiclink&redirect_to=http://localhost:3000";

  it("pulls the token out of a real magic link", async () => {
    const { extractTokenHash } = await import("./index");
    expect(extractTokenHash(LINK)).toBe("b7f3c1a9e2d84");
  });

  it("handles a link with a trailing newline from a paste", async () => {
    const { extractTokenHash } = await import("./index");
    expect(extractTokenHash(`${LINK}\n`.trim())).toBe("b7f3c1a9e2d84");
  });

  it("returns null for a 6-digit code so it goes down the OTP path", async () => {
    const { extractTokenHash } = await import("./index");
    expect(extractTokenHash("483920")).toBeNull();
  });

  it("reads token_hash from a fragment-style link", async () => {
    const { extractTokenHash } = await import("./index");
    expect(
      extractTokenHash("https://app.example.com/#token_hash=abc123def&type=magiclink"),
    ).toBe("abc123def");
  });

  it("treats a bare long token as a hash", async () => {
    const { extractTokenHash } = await import("./index");
    expect(extractTokenHash("pkce_9f8e7d6c5b4a3")).toBe("pkce_9f8e7d6c5b4a3");
  });
});

describe("company backfill on push", () => {
  // Mike's phone reached the signed-in state without ever resolving an acting
  // company (he signed in before the membership flow existed, and the backend
  // cutover cleared it), so every row it wrote carried no company_id and the
  // server refused all 214 of them: "new row violates row-level security
  // policy". Once the company resolves, this backfill is what makes the
  // already-queued rows pushable — nothing has to be re-entered.
  const row = (extra: Record<string, unknown> = {}) =>
    ({ id: "w1", updated_at: "2026-09-09T00:00:00.000Z", deleted: false, ...extra }) as never;

  it("stamps the acting company onto a row written without one", () => {
    setCompanyIdCache("c0000001-0000-4000-8000-000000000001");
    const out = normalizeForPush("windows", row()) as unknown as Record<string, unknown>;
    expect(out.company_id).toBe("c0000001-0000-4000-8000-000000000001");
  });

  it("never overwrites the company a row was created under", () => {
    setCompanyIdCache("c0000001-0000-4000-8000-000000000001");
    const out = normalizeForPush("windows", row({ company_id: "other" })) as unknown as Record<string, unknown>;
    expect(out.company_id).toBe("other");
  });

  it("leaves the row alone when no company has resolved yet", () => {
    setCompanyIdCache(null);
    const out = normalizeForPush("windows", row()) as unknown as Record<string, unknown>;
    expect(out.company_id).toBeUndefined();
  });

  it("never stamps a company onto the companies table itself", () => {
    setCompanyIdCache("c0000001-0000-4000-8000-000000000001");
    const out = normalizeForPush("companies", row()) as unknown as Record<string, unknown>;
    expect(out.company_id).toBeUndefined();
  });
});

describe("companies is update-only on push", () => {
  // Mike's phone, 2026-09-09: "214 changes waiting to upload. Last sync
  // problem: new row violates row-level security policy for table companies."
  // His claims resolve to the right company and he IS a company admin — but
  // not a PLATFORM admin, and `companies_insert` is
  // `with check (is_platform_admin())`. PostgREST's .upsert() sends
  // INSERT ... ON CONFLICT DO UPDATE, and Postgres checks the INSERT policy
  // on that statement even when only the UPDATE branch can run. Verified
  // against production under his JWT: the upsert is refused with exactly that
  // message, a plain UPDATE of the same row is allowed.
  it("never sends an insert for the tenant's own row", () => {
    expect(pushIsUpdateOnly("companies")).toBe(true);
  });

  it("still upserts every tenant table, which devices do create rows in", () => {
    for (const table of ["projects", "floors", "units", "windows", "memberships"] as const) {
      expect(pushIsUpdateOnly(table)).toBe(false);
    }
  });
});

describe("backoff only punishes errors that waiting can fix", () => {
  // A refused request fails identically in five minutes, and the shared
  // window made every other table — and the entire pull — wait it out with
  // it. Postgres passes its SQLSTATE through PostgREST, so the two cases are
  // distinguishable.
  it("treats an RLS refusal as permanent", () => {
    expect(isPermanentError({ code: "42501", message: "new row violates row-level security policy" })).toBe(true);
  });

  it("treats a constraint violation as permanent", () => {
    expect(isPermanentError({ code: "23503", message: "violates foreign key constraint" })).toBe(true);
  });

  it("treats a dropped connection as transient, so it still backs off", () => {
    expect(isPermanentError(new TypeError("Failed to fetch"))).toBe(false);
    expect(isPermanentError({ message: "network error" })).toBe(false);
    expect(isPermanentError({ code: "503" })).toBe(false);
  });
});

describe("distinctPendingRows", () => {
  // The pending count is what the crew reads to judge how much is at risk.
  // Entries are per keystroke; rows are what upload. One form fill produced
  // 214 entries for a single row and read as a disaster (2026-09-08).
  it("counts one row however many keystrokes queued it", () => {
    const entries = Array.from({ length: 214 }, () => ({ table: "companies" as const, rowId: "c1" }));
    expect(distinctPendingRows(entries)).toBe(1);
  });

  it("counts distinct rows across tables, not entries", () => {
    expect(
      distinctPendingRows([
        { table: "windows", rowId: "w1" },
        { table: "windows", rowId: "w1" },
        { table: "windows", rowId: "w2" },
        { table: "units", rowId: "u1" },
        { table: "companies", rowId: "c1" },
        { table: "companies", rowId: "c1" },
      ])
    ).toBe(4);
  });

  it("keeps the same id on different tables apart", () => {
    expect(distinctPendingRows([{ table: "units", rowId: "x" }, { table: "windows", rowId: "x" }])).toBe(2);
  });

  it("is zero for an empty outbox", () => {
    expect(distinctPendingRows([])).toBe(0);
  });
});
