import { describe, expect, it } from "vitest";
import { signOutWarning } from "./account-card-inner";

describe("signOutWarning", () => {
  // Sign out is the one button on this screen that can destroy a day's work:
  // the outbox lives in this browser, so anything not yet uploaded goes with
  // the session. The warning has to say how much and how to save it.
  it("names the count and the way out when work is queued", () => {
    const w = signOutWarning(214);
    expect(w).toContain("214 changes have not uploaded");
    expect(w).toContain("Sync now");
  });

  it("reads correctly for a single change", () => {
    const w = signOutWarning(1);
    expect(w).toContain("1 change has not uploaded");
    expect(w).toContain("loses it");
    expect(w).not.toContain("changes have");
  });

  it("asks plainly when there is nothing to lose", () => {
    for (const n of [0, -1]) {
      expect(signOutWarning(n)).toBe("Sign out of this phone?");
    }
  });
});
