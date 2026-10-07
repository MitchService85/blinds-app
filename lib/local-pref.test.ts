import { afterEach, describe, expect, it, vi } from "vitest";
import { readPref, writePref } from "./local-pref";

describe("local prefs", () => {
  afterEach(() => vi.restoreAllMocks());

  it("round-trips a value", () => {
    writePref("measure:test", "32");
    expect(readPref("measure:test")).toBe("32");
  });

  it("reads null and writes nothing when storage throws", () => {
    // Safari with "Block All Cookies" throws on any access.
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("The operation is insecure.", "SecurityError");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
    });
    expect(readPref("measure:test")).toBeNull();
    expect(() => writePref("measure:test", "16")).not.toThrow();
  });
});
