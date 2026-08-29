import { describe, expect, it } from "vitest";

import {
  centsToInput,
  joinScopeLines,
  priceMoveLabel,
  scopeLines,
  trimProposal,
  trimSummary,
} from "./proposal-trim";
import type { ProposalZoneSnapshot } from "@/types/domain";

function zone(overrides: Partial<ProposalZoneSnapshot> = {}): ProposalZoneSnapshot {
  return {
    zoneName: "Front bed",
    serviceLabel: "Mulch",
    scopeText: "Edge the bed. Lay two yards of hardwood mulch.",
    photoPaths: [],
    points: [],
    color: "#0f0",
    priceCents: 45000,
    priceDerived: true,
    ...overrides,
  };
}

describe("scopeLines", () => {
  it("splits a bulleted scope into its lines", () => {
    expect(scopeLines("- Edge the bed\n- Lay mulch\n- Haul away")).toEqual([
      "Edge the bed",
      "Lay mulch",
      "Haul away",
    ]);
  });

  it("splits a paragraph into sentences, keeping the punctuation", () => {
    expect(scopeLines("Edge the bed. Lay two yards of mulch.")).toEqual([
      "Edge the bed.",
      "Lay two yards of mulch.",
    ]);
  });

  it("keeps a one-sentence scope whole", () => {
    expect(scopeLines("Cut back the hedge")).toEqual(["Cut back the hedge"]);
  });

  it("has nothing to remove from an empty scope", () => {
    expect(scopeLines("")).toEqual([]);
    expect(scopeLines("   ")).toEqual([]);
  });

  it("survives a round trip through the join", () => {
    const text = "Edge the bed. Lay two yards of mulch.";
    expect(joinScopeLines(scopeLines(text))).toBe(text);
  });
});

describe("trimProposal", () => {
  const zones = [
    zone(),
    zone({ zoneName: "Back bed", serviceLabel: "Mulch", priceCents: 30000 }),
    zone({ zoneName: "Hedge", serviceLabel: "Hedge Trim", priceCents: 25000 }),
  ];
  const statedTotalCents = 100000;

  it("takes an area off and takes its price with it", () => {
    const result = trimProposal({ zones, removeZones: ["Back bed"], removeLines: [], statedTotalCents });
    expect(result.zones.map((z) => z.zoneName)).toEqual(["Front bed", "Hedge"]);
    expect(result.removedCents).toBe(30000);
    expect(result.newTotalCents).toBe(70000);
    expect(result.totalExact).toBe(true);
    expect(result.totalNote).toBeNull();
  });

  it("takes a written line off without touching the price", () => {
    const result = trimProposal({
      zones,
      removeZones: [],
      removeLines: [{ zoneName: "Front bed", line: "Lay two yards of hardwood mulch." }],
      statedTotalCents,
    });
    expect(result.newTotalCents).toBe(statedTotalCents);
    expect(result.removedCents).toBe(0);
    expect(result.zones[0].scopeText).toBe("Edge the bed.");
    expect(result.removedLines).toEqual([
      { zoneName: "Front bed", line: "Lay two yards of hardwood mulch." },
    ]);
  });

  it("removes an area and a line in the same pass", () => {
    const result = trimProposal({
      zones,
      removeZones: ["Hedge"],
      removeLines: [{ zoneName: "Front bed", line: "Edge the bed." }],
      statedTotalCents,
    });
    expect(result.zones.map((z) => z.zoneName)).toEqual(["Front bed", "Back bed"]);
    expect(result.zones[0].scopeText).toBe("Lay two yards of hardwood mulch.");
    expect(result.newTotalCents).toBe(75000);
  });

  it("says so when a removed area had no price to take off", () => {
    const result = trimProposal({
      zones: [zone(), zone({ zoneName: "Back bed", priceCents: null })],
      removeZones: ["Back bed"],
      removeLines: [],
      statedTotalCents,
    });
    expect(result.totalExact).toBe(false);
    expect(result.newTotalCents).toBe(statedTotalCents);
    expect(result.totalNote).toMatch(/no price/i);
  });

  it("flags a hand-entered price rather than quietly subtracting it", () => {
    const result = trimProposal({
      zones: [zone(), zone({ zoneName: "Back bed", priceCents: 30000, priceDerived: false })],
      removeZones: ["Back bed"],
      removeLines: [],
      statedTotalCents,
    });
    expect(result.totalExact).toBe(false);
    expect(result.totalNote).toMatch(/by hand/i);
    // Still offered, because the office is the one looking at it.
    expect(result.newTotalCents).toBe(70000);
  });

  it("never takes a total below nothing", () => {
    const result = trimProposal({
      zones,
      removeZones: ["Front bed", "Back bed", "Hedge"],
      removeLines: [],
      statedTotalCents: 10000,
    });
    expect(result.newTotalCents).toBe(0);
  });

  it("knows when nothing was actually taken off", () => {
    expect(trimProposal({ zones, removeZones: [], removeLines: [], statedTotalCents }).empty).toBe(true);
    expect(
      trimProposal({ zones, removeZones: ["Nowhere"], removeLines: [], statedTotalCents }).empty
    ).toBe(true);
  });

  it("leaves the original snapshot alone", () => {
    const before = JSON.stringify(zones);
    trimProposal({
      zones,
      removeZones: ["Hedge"],
      removeLines: [{ zoneName: "Front bed", line: "Edge the bed." }],
      statedTotalCents,
    });
    expect(JSON.stringify(zones)).toBe(before);
  });
});

describe("trimSummary", () => {
  it("names the areas that came off", () => {
    expect(
      trimSummary({
        removedZones: [{ zoneName: "Back bed", serviceLabel: "Mulch" }],
        removedLines: [],
      })
    ).toBe("Removed Back bed (Mulch)");
  });

  it("counts written lines and says where they were", () => {
    expect(
      trimSummary({ removedZones: [], removedLines: [{ zoneName: "Front bed" }] })
    ).toBe("Removed 1 written line from Front bed");
  });

  it("summarises lines across several areas", () => {
    const out = trimSummary({
      removedZones: [],
      removedLines: [{ zoneName: "Front bed" }, { zoneName: "Hedge" }],
    });
    expect(out).toBe("Removed 2 written lines from 2 areas");
  });

  it("says plainly when nothing came off", () => {
    expect(trimSummary({ removedZones: [], removedLines: [] })).toBe("Nothing removed");
  });
});

describe("priceMoveLabel", () => {
  it("shows what came off", () => {
    expect(priceMoveLabel(100000, 70000)).toBe("−$300.00");
  });

  it("shows a rise too, since somebody can type any number", () => {
    expect(priceMoveLabel(70000, 100000)).toBe("+$300.00");
  });

  it("says nothing moved when nothing did", () => {
    expect(priceMoveLabel(70000, 70000)).toBe("price unchanged");
  });
});

describe("centsToInput", () => {
  it("fills the price box with dollars", () => {
    expect(centsToInput(70000)).toBe("700.00");
    expect(centsToInput(0)).toBe("0.00");
  });
});
