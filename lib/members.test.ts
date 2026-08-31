import { describe, expect, it } from "vitest";

/**
 * Invite normalisation, kept as a pure helper so the rule is testable without
 * IndexedDB. The lowercase rule is not cosmetic: GoTrue lowercases the address
 * in the JWT, and storing Mike's capital M as typed once locked him out of the
 * old project entirely.
 */
function normalizeInviteEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

function isDuplicate(existing: string[], raw: string): boolean {
  return existing.includes(normalizeInviteEmail(raw));
}

describe("invite email handling", () => {
  it("lowercases, so a capital letter cannot lock someone out", () => {
    expect(normalizeInviteEmail("Michael@KeepItShady.ca")).toBe("michael@keepitshady.ca");
  });

  it("trims whitespace pasted from a contact card", () => {
    expect(normalizeInviteEmail("  mike@example.com \n")).toBe("mike@example.com");
  });

  it("catches a duplicate that differs only by case", () => {
    expect(isDuplicate(["michael@keepitshady.ca"], "Michael@KeepItShady.ca")).toBe(true);
  });

  it("does not flag a genuinely new address", () => {
    expect(isDuplicate(["michael@keepitshady.ca"], "danny@ledecor.ca")).toBe(false);
  });
});
