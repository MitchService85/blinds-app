import { beforeEach, describe, expect, it } from "vitest";
import { getCompanyIdSync, setCompanyIdCache } from "./tenant";

describe("acting company", () => {
  beforeEach(() => setCompanyIdCache(null));

  it("is null before sign-in resolves a membership", () => {
    expect(getCompanyIdSync()).toBeNull();
  });

  it("reads back synchronously so writes never await", () => {
    // lib/db.ts's write funnel stamps rows without awaiting; if this were
    // async every measurement tap would race the lookup.
    setCompanyIdCache("company-1");
    expect(getCompanyIdSync()).toBe("company-1");
  });

  it("clears on sign-out, so nothing can be written under the old company", () => {
    setCompanyIdCache("company-1");
    setCompanyIdCache(null);
    expect(getCompanyIdSync()).toBeNull();
  });

  it("has no imports, so lib/db.ts can depend on it without a cycle", async () => {
    // db.ts stamps every write from this module; if this file ever imports
    // db.ts back the cycle returns, and it only bites at runtime.
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("lib/tenant.ts", "utf8");
    const importLines = src.split("\n").filter((l) => /^\s*import\s/.test(l));
    expect(importLines).toEqual([]);
  });
});
