import { describe, expect, it } from "vitest";

import {
  atSigningForSnapshot,
  depositCapCents,
  dueAtSigning,
  isHomeImprovementScope,
  isHomeImprovementService,
  mayTakePayment,
  mhicContractClauses,
  servicesOfSnapshot,
} from "@/lib/sales/mhic";

describe("what is home improvement", () => {
  it("exempts mowing, fertilizing, seeding and mulch on its own", () => {
    for (const key of ["mowing-edging", "lawn-care", "fertilization", "seeding", "mulch-install", "snow-removal", "leaf-removal"]) {
      expect(isHomeImprovementService(key)).toBe(false);
    }
    expect(isHomeImprovementService("Weekly Mowing", "Weekly Mowing")).toBe(false);
    expect(isHomeImprovementService("Salting", "Salting")).toBe(false);
  });

  it("covers planting, beds, grading, stone and irrigation", () => {
    for (const key of ["plant-install-1gal", "landscape-bed", "hand-grading", "rock-install", "sod-install"]) {
      expect(isHomeImprovementService(key)).toBe(true);
    }
    expect(isHomeImprovementService("custom-9", "Paver patio")).toBe(true);
    expect(isHomeImprovementService("custom-10", "Sprinkler repair")).toBe(true);
  });

  it("makes the whole scope home improvement when any one part is", () => {
    expect(isHomeImprovementScope([{ key: "mowing-edging" }, { key: "plant-install-3gal" }])).toBe(true);
    expect(isHomeImprovementScope([{ key: "mowing-edging" }, { key: "leaf-removal" }])).toBe(false);
  });

  it("reads the scope off a proposal snapshot", () => {
    const services = servicesOfSnapshot([
      { serviceLabel: "Lawn Care", lines: [{ key: "mowing-edging" }] },
      { serviceLabel: "Landscape Bed", lines: [{ key: "mulch-install" }] },
    ]);
    expect(isHomeImprovementScope(services)).toBe(true);
    expect(isHomeImprovementScope(servicesOfSnapshot([{ serviceLabel: "Lawn Care", lines: [{ key: "mowing-edging" }] }]))).toBe(false);
  });
});

describe("the deposit", () => {
  it("is capped at one-third, rounded down to the cent", () => {
    expect(depositCapCents(300_000)).toBe(100_000);
    expect(depositCapCents(100_001)).toBe(33_333);
    expect(depositCapCents(0)).toBe(0);
  });

  it("lets exempt work be paid in full at signing", () => {
    expect(dueAtSigning({ contractCents: 50_000, homeImprovement: false })).toEqual({ dueNowCents: 50_000, laterCents: 0, isDeposit: false, note: null });
  });

  it("takes at most a third now on home-improvement work, the rest later", () => {
    const due = dueAtSigning({ contractCents: 600_000, homeImprovement: true });
    expect(due.dueNowCents).toBe(200_000);
    expect(due.laterCents).toBe(400_000);
    expect(due.isDeposit).toBe(true);
    expect(due.note).toMatch(/one-third/);
  });

  it("never lets a requested deposit past the cap, but allows a smaller one", () => {
    expect(dueAtSigning({ contractCents: 600_000, homeImprovement: true, requestedDepositCents: 500_000 }).dueNowCents).toBe(200_000);
    expect(dueAtSigning({ contractCents: 600_000, homeImprovement: true, requestedDepositCents: 50_000 }).dueNowCents).toBe(50_000);
  });

  it("reads the cap straight off a snapshot", () => {
    expect(atSigningForSnapshot(90_000, [{ serviceLabel: "Landscape Bed" }]).dueNowCents).toBe(30_000);
    expect(atSigningForSnapshot(90_000, [{ serviceLabel: "Lawn Care", lines: [{ key: "mowing-edging" }] }]).dueNowCents).toBe(90_000);
    expect(atSigningForSnapshot(90_000, null).dueNowCents).toBe(90_000);
  });

  it("takes nothing before the contract is signed", () => {
    expect(mayTakePayment("sent")).toBe(false);
    expect(mayTakePayment("needs_approval")).toBe(false);
    expect(mayTakePayment("accepted")).toBe(true);
  });
});

describe("the contract wording", () => {
  const clauses = mhicContractClauses({
    businessName: "JS Landscaping",
    businessAddress: "1 Main St, Bel Air, MD 21014",
    mhicLicense: "123456",
    salesperson: { name: "Jace", license: null },
    contractCents: 300_000,
  });
  const text = clauses.map((c) => `${c.heading} ${c.body}`).join(" ");

  it("carries every item the Commission lists", () => {
    expect(text).toContain("MHIC licence number 123456");
    expect(text).toContain("JS Landscaping, 1 Main St");
    expect(text).toContain("Sold by Jace");
    expect(text).toContain("$3,000.00");
    expect(text).toContain("at most $1,000.00");
    expect(text).toMatch(/must hold a current license from the Maryland Home Improvement Commission/);
    expect(text).toMatch(/Guaranty Fund/);
    expect(text).toMatch(/performance bond/);
    expect(text).toMatch(/Approximate start/);
    expect(text).toMatch(/signed copy/);
  });

  it("says plainly when the licence number is missing rather than printing a blank", () => {
    const missing = mhicContractClauses({ businessName: "JS", businessAddress: null, mhicLicense: null, contractCents: 100 });
    expect(missing[0].body).toContain("to be added before signing");
  });
});
