import { describe, expect, it } from "vitest";
import {
  digitsOf,
  isConfident,
  payerSearchTerm,
  scoreAgainstPayer,
  suggestForPayer,
  type SearchableContact,
} from "./payer-match";

const c = (
  id: string,
  name: string | null,
  email: string | null,
  phone: string | null = null
): SearchableContact => ({ id, name, email, phone });

describe("scoreAgainstPayer", () => {
  it("ranks an email match highest", () => {
    const m = scoreAgainstPayer(c("1", "J Smith", "jane@example.com"), {
      name: "Jane Smith",
      email: "jane@example.com",
    });
    expect(m.score).toBe(100);
    expect(m.reason).toMatch(/email/i);
  });

  it("ignores case and stray spaces on the email", () => {
    const m = scoreAgainstPayer(c("1", "Jane", " Jane@Example.com "), { email: "jane@example.com" });
    expect(m.score).toBe(100);
  });

  it("matches a phone however it was written down", () => {
    const m = scoreAgainstPayer(c("1", "Jane", null, "(410) 555-0123"), {
      phone: "+1 410 555 0123",
    });
    expect(m.score).toBe(90);
  });

  it("scores a name match well short of certain", () => {
    // A county has more than one Dave Miller. Offered, never assumed.
    const m = scoreAgainstPayer(c("1", "Dave Miller", null), { name: "Dave Miller" });
    expect(m.score).toBe(60);
    expect(isConfident(m)).toBe(false);
  });

  it("offers a shared surname faintly", () => {
    const m = scoreAgainstPayer(c("1", "Robert Castellano", null), { name: "Marie Castellano" });
    expect(m.score).toBe(30);
  });

  it("does not read a shared initial as a surname", () => {
    expect(scoreAgainstPayer(c("1", "Jane B", null), { name: "Tom B" }).score).toBe(0);
  });

  it("scores nothing when the payment said nothing", () => {
    expect(scoreAgainstPayer(c("1", "Jane", "jane@example.com"), {}).score).toBe(0);
  });

  it("does not match two contacts who both have nothing", () => {
    // Empty against empty is not a match, or every blank contact matches
    // every payment that arrived without a name on it.
    expect(scoreAgainstPayer(c("1", "Jane", ""), { email: "" }).score).toBe(0);
    expect(scoreAgainstPayer(c("1", "Jane", null), { phone: "" }).score).toBe(0);
    expect(scoreAgainstPayer(c("1", null, null), { name: "" }).score).toBe(0);
  });
});

describe("suggestForPayer", () => {
  const book = [
    c("1", "Jane Smith", "jane@example.com", "4105550123"),
    c("2", "Dave Miller", "dave@example.com"),
    c("3", "Jane Smith", null),
    c("4", "Nobody Relevant", "nr@example.com"),
  ];

  it("puts the email match first", () => {
    const out = suggestForPayer(book, { name: "Jane Smith", email: "jane@example.com" });
    expect(out[0].id).toBe("1");
    expect(out[0].score).toBe(100);
  });

  it("leaves out everyone who matches on nothing", () => {
    expect(suggestForPayer(book, { email: "jane@example.com" }).map((o) => o.id)).toEqual(["1"]);
  });

  it("returns nothing at all when the payment carried no detail", () => {
    // Better an empty list than a list of strangers to tap.
    expect(suggestForPayer(book, {})).toEqual([]);
  });

  it("caps how many it offers", () => {
    const many = Array.from({ length: 20 }, (_, i) => c(String(i), "Dave Miller", null));
    expect(suggestForPayer(many, { name: "Dave Miller" })).toHaveLength(5);
  });
});

describe("payerSearchTerm", () => {
  it("waits for two characters", () => {
    expect(payerSearchTerm("j")).toBeNull();
    expect(payerSearchTerm("  ")).toBeNull();
    expect(payerSearchTerm(" jo ")).toBe("jo");
  });
});

describe("digitsOf", () => {
  it("keeps only the numbers", () => {
    expect(digitsOf("(410) 555-0123")).toBe("4105550123");
    expect(digitsOf(null)).toBe("");
  });
});
