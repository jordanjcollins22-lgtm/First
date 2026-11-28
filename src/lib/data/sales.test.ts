import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
import { workLine } from "./sales";

describe("workLine", () => {
  it("keeps a plain description", () => {
    expect(workLine("Fence install", null)).toBe("Fence install");
  });
  it("keeps the add-on part of an address name", () => {
    expect(workLine("217 Ewing Street, Bel Air, Add-on: fence soft wash and stump grinding", null)).toBe("Add-on: fence soft wash and stump grinding");
    expect(workLine("1120 Harford Town Drive, Aeration and overseeding", null)).toBe("Aeration and overseeding");
  });
  it("uses the proposal's services instead of Estimate", () => {
    expect(workLine("1602 Waterbury Court, Bel Air, Maryland 21014, United States — Estimate", [{ serviceLabel: "Trimming" }, { serviceLabel: "Mulch" }, { serviceLabel: "Trimming" }])).toBe("Trimming, Mulch");
  });
  it("falls back to the first line of the scope", () => {
    expect(workLine("439 Oakton Way, Abingdon, Maryland 21009, United States — Estimate", [{ scopeText: "* Trim branches extending toward or over the back fence.\n* Cut back." }])).toBe("Trim branches extending toward or over the back fence.");
  });
});

describe("workLine with commas in a plain name", () => {
  it("does not cut a plain description at its commas", () => {
    expect(workLine("Remove old retaining wall and bed plants, fence removal, one lawn cut, plus 3 salting visits", null)).toBe(
      "Remove old retaining wall and bed plants, fence removal, one lawn cut, plus 3 salting visits"
    );
  });
});
