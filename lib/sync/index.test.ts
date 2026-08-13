import { describe, expect, it } from "vitest";
import { drainOutbox, isSyncConfigured, pullSince, signInWithEmail } from "./index";

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
