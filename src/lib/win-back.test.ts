import { describe, expect, it } from "vitest";

import type { ProposalZoneSnapshot } from "@/types/domain";
import { phaseNote, phaseOnePriceProblem, phaseOneSnapshot, winBackRows, winBackText, type WinBackInput } from "@/lib/win-back";

const row = (over: Partial<WinBackInput>): WinBackInput => ({
  jobId: "j",
  client: "Sample Client",
  phone: null,
  email: null,
  address: null,
  total: 1000,
  discount: 0,
  declinedAt: null,
  note: null,
  officeDeclined: false,
  jobStatus: "quoted",
  areas: [],
  ...over,
});

const zone = (zoneName: string): ProposalZoneSnapshot => ({ zoneName, serviceLabel: "Beds", scopeText: "", photoPaths: [], points: [], color: "#000" });

describe("winBackRows", () => {
  it("keeps the client's declines, biggest owed first", () => {
    const rows = winBackRows([
      row({ jobId: "small", total: 3500, discount: 350 }),
      row({ jobId: "big", total: 22150, discount: 2215 }),
      row({ jobId: "ours", total: 9000, officeDeclined: true }),
      row({ jobId: "free", total: 0 }),
      row({ jobId: "gone", total: 5000, jobStatus: "cancelled" }),
    ]);
    expect(rows.map((r) => r.jobId)).toEqual(["big", "small"]);
    expect(rows[0].owed).toBe(19935);
  });
});

describe("phaseOneSnapshot", () => {
  it("keeps the ticked areas in order", () => {
    expect(phaseOneSnapshot([zone("Zone 1"), zone("Zone 2"), zone("Zone 3")], ["Zone 3", "Zone 1"])?.map((z) => z.zoneName)).toEqual(["Zone 1", "Zone 3"]);
    expect(phaseOneSnapshot([zone("Zone 1")], [])).toBeNull();
  });
});

describe("phaseOnePriceProblem", () => {
  it("wants a price under what was declined", () => {
    expect(phaseOnePriceProblem(0, 5000)).toBe("Type the Phase 1 price.");
    expect(phaseOnePriceProblem(5000, 5000)).toMatch(/less than/);
    expect(phaseOnePriceProblem(4200, 5000)).toBeNull();
  });
});

describe("the words", () => {
  it("notes the split and offers it plainly", () => {
    expect(phaseNote({ declinedTotal: 22150, price: 6500, kept: ["Zone 1", "Zone 2"], later: ["Zone 3"], by: "Jordan" })).toBe(
      "Phase 1 made from the $22,150 proposal they declined, by Jordan: Zone 1, Zone 2 at $6,500. Phase 2, for later: Zone 3."
    );
    expect(winBackText({ first: "Sam", sender: "Jordan", price: 6500 })).toContain("first for $6,500 this fall");
  });
});
