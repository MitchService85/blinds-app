// Which company this device is acting as.
//
// Every tenant-owned row carries company_id and the server enforces it: RLS
// rejects a write stamped with anyone else's id. This module is the client
// half — the acting company, held in memory so lib/db.ts's write funnel can
// stamp every row synchronously without awaiting.
//
// Deliberately dependency-free. lib/db.ts needs this value on every write, so
// importing db here would make a cycle (db -> tenant -> db); persistence lives
// in lib/db.ts's meta helpers instead, driven by the auth layer, which already
// imports both.

/**
 * The signed-out sandbox's company. Reserved: gen_random_uuid() cannot issue
 * it, so it can never collide with a real company. Lives here rather than in
 * lib/demo.ts because lib/db.ts's write funnel must recognise a demo row to
 * keep it out of the outbox, and importing demo.ts there would cycle.
 */
export const DEMO_COMPANY_ID = "00000000-0000-0000-0000-0000000d3m0";

let cached: string | null = null;

/** The company this device writes as, or null before sign-in resolves one. */
export function getCompanyIdSync(): string | null {
  return cached;
}

/**
 * Set after sign-in resolves the membership, and at startup from the cached
 * meta value — a phone that has not reached the network since sign-in must
 * still be able to record measurements offline.
 */
export function setCompanyIdCache(companyId: string | null): void {
  cached = companyId;
}
