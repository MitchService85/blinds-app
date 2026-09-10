import { afterEach, describe, expect, it } from "vitest";
import { productionOrigin } from "./origin";

describe("productionOrigin", () => {
  // A PM link built from a branch alias or deploy URL sends the PM into
  // Vercel's sign-in wall; only the production domain is open to outsiders.
  const KEY = "NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL";
  const before = process.env[KEY];
  afterEach(() => {
    if (before === undefined) delete process.env[KEY];
    else process.env[KEY] = before;
  });

  it("prefers the production host over the address the page is open at", () => {
    process.env[KEY] = "blinds-app-three.vercel.app";
    expect(productionOrigin("https://blinds-app-git-main-x.vercel.app")).toBe(
      "https://blinds-app-three.vercel.app"
    );
  });

  it("normalises a host given with a scheme or trailing slash", () => {
    process.env[KEY] = "https://blinds-app-three.vercel.app/";
    expect(productionOrigin("https://elsewhere.test")).toBe("https://blinds-app-three.vercel.app");
  });

  it("falls back to the current address when the build has no production host", () => {
    delete process.env[KEY];
    expect(productionOrigin("http://localhost:3000")).toBe("http://localhost:3000");
  });
});
