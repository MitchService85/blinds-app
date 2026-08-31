import { describe, expect, it } from "vitest";
import { DEMO_COMPANY_ID, isDemoRow } from "./demo";

describe("signed-out sandbox", () => {
  it("recognises a demo row by its reserved company", () => {
    expect(isDemoRow({ company_id: DEMO_COMPANY_ID })).toBe(true);
  });

  it("does not mistake a real company's row for the sandbox", () => {
    // Keep It Shady's id. A false positive here would hide real jobs;
    // a false negative would show a client's work to a signed-out visitor.
    expect(isDemoRow({ company_id: "c0000001-0000-4000-8000-000000000001" })).toBe(false);
  });

  it("treats an unstamped row as real, not demo", () => {
    // Rows written before a device resolved its membership have no company
    // yet. They are the crew's work and must never be filtered away as demo.
    expect(isDemoRow({})).toBe(false);
    expect(isDemoRow({ company_id: undefined })).toBe(false);
  });

  it("uses a company id that cannot collide with a real uuid v4", () => {
    // Real ids come from gen_random_uuid(); this one is deliberately
    // hand-shaped so it can never be issued by the database.
    expect(DEMO_COMPANY_ID).toContain("d3m0");
  });
});

describe("what the dashboard shows", () => {
  const demo = { company_id: DEMO_COMPANY_ID };
  const real = { company_id: "c0000001-0000-4000-8000-000000000001" };
  const visible = (rows: { company_id?: string }[], signedIn: boolean) =>
    rows.filter((p) => (signedIn ? !isDemoRow(p) : isDemoRow(p)));

  it("shows only the sandbox when signed out", () => {
    expect(visible([demo, real], false)).toEqual([demo]);
  });

  it("shows only real jobs when signed in", () => {
    expect(visible([demo, real], true)).toEqual([real]);
  });

  it("never shows a client job to a signed-out visitor", () => {
    expect(visible([real, real], false)).toEqual([]);
  });
});
