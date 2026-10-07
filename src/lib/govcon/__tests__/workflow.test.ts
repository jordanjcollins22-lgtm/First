import { describe, expect, it } from "vitest";

import type { QuoteCheck } from "../ai";
import { quoteDueAt } from "../pipeline/source";
import { selectBestQuote, type QuoteForSelection } from "../quote-selection";
import { rfqEmail, sanitizeScopeForSub } from "../templates";

const check = (compliant: boolean, gaps: string[] = []): QuoteCheck => ({
  compliant,
  coveragePct: compliant ? 100 : 70,
  gaps,
  substitutions: [],
  exclusions: [],
  periodsCovered: "base",
  totalPrice: null,
  summary: "",
});

const quote = (id: string, amount: number, extra: Partial<QuoteForSelection> = {}): QuoteForSelection => ({
  id,
  amount,
  compliance: null,
  is_small_business: true,
  uses_own_employees: true,
  accepts_net30: true,
  down_payment_pct: null,
  ...extra,
});

describe("selectBestQuote", () => {
  it("picks the lowest price that fully matches the scope, not the lowest price", () => {
    const sel = selectBestQuote(
      [quote("cheap-12-ton", 12_000, { compliance: check(false, ["Quoted 12-ton unit; SOW requires 14-ton"]) }), quote("ok", 15_000, { compliance: check(true) }), quote("pricey", 18_000, { compliance: check(true) })],
      { status: "unrestricted" }
    );
    expect(sel.chosen?.id).toBe("ok");
    expect(sel.rejected.find((r) => r.quote.id === "cheap-12-ton")?.reason).toMatch(/14-ton/);
  });

  it("requires small, self-performing subs when the subcontracting limit applies", () => {
    const sel = selectBestQuote(
      [quote("big", 10_000, { is_small_business: false }), quote("small", 11_000)],
      { status: "similarly_situated_required" }
    );
    expect(sel.chosen?.id).toBe("small");
  });

  it("returns nothing when no quote is usable, and warns on deposits", () => {
    expect(selectBestQuote([quote("bad", 9_000, { compliance: check(false) })], null).chosen).toBeNull();
    const sel = selectBestQuote([quote("dep", 9_000, { down_payment_pct: 50 })], null);
    expect(sel.warnings.join(" ")).toMatch(/50% down/);
  });
});

describe("quoteDueAt", () => {
  const now = new Date("2026-10-07T12:00:00Z");
  it("asks for quotes 3 days before the government deadline", () => {
    expect(quoteDueAt("2026-10-25T17:00:00Z", now)).toBe("2026-10-22T17:00:00.000Z");
  });
  it("never sets a due date less than 2 days out or past the deadline", () => {
    expect(quoteDueAt("2026-10-13T17:00:00Z", now)).toBe("2026-10-10T17:00:00.000Z");
    expect(Date.parse(quoteDueAt("2026-10-11T17:00:00Z", now))).toBeLessThan(Date.parse("2026-10-11T17:00:00Z"));
  });
});

describe("sub-facing scope", () => {
  it("strips government contacts and identifiers", () => {
    const out = sanitizeScopeForSub(
      "Mow 40 acres weekly. Questions to the Contracting Officer, Jane Doe, jane.doe@usace.army.mil, (555) 123-4567. Solicitation W912QR26Q0042. See https://sam.gov/opp/abc/view",
      ["W912QR26Q0042"]
    );
    expect(out).toContain("Mow 40 acres weekly.");
    expect(out).not.toMatch(/usace|555|W912QR26Q0042|sam\.gov|Jane Doe/);
  });

  it("builds an RFQ email with the portal link and SCA notice", () => {
    const msg = rfqEmail({
      company: { name: "Acme Gov LLC", uei: null, cage: null, address: null, contactName: "Sam", email: null, phone: "555-0100" },
      subName: "Green Lawn Co",
      tradeLabel: "Landscaping & grounds maintenance",
      location: "Fort Hancock, NJ 07732",
      scopeSummary: "Weekly mowing of 40 acres, April–October.",
      quoteDueAt: "2026-10-22T17:00:00Z",
      portalUrl: "https://example.test/quote/tok",
      requiresSmallBusiness: true,
      wageDetermination: "2015-4281 Rev 30",
    });
    expect(msg.subject).toContain("Fort Hancock");
    expect(msg.text).toContain("https://example.test/quote/tok");
    expect(msg.text).toContain("2015-4281");
    expect(msg.text).toMatch(/small business/);
  });
});
