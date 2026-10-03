import { describe, expect, it } from "vitest";

import {
  canRecheck,
  checkSenderAddress,
  checkSendingDomain,
  describeStatus,
  domainForStream,
  normaliseAddress,
  parseHostname,
  suggestSubdomain,
  type DomainStatus,
  type MailStream,
} from "./sending-domains";

describe("parseHostname", () => {
  it("splits a subdomain from its root", () => {
    expect(parseHostname("send.jslandscapingmd.com")).toMatchObject({
      hostname: "send.jslandscapingmd.com",
      root: "jslandscapingmd.com",
      subdomain: "send",
      isSubdomain: true,
    });
  });

  it("recognises a bare root", () => {
    expect(parseHostname("jslandscapingmd.com")).toMatchObject({
      root: "jslandscapingmd.com",
      subdomain: "",
      isSubdomain: false,
    });
  });

  it("handles a two-label suffix", () => {
    expect(parseHostname("news.example.co.uk")).toMatchObject({
      root: "example.co.uk",
      subdomain: "news",
      isSubdomain: true,
    });
    expect(parseHostname("example.co.uk")?.isSubdomain).toBe(false);
  });

  it("takes the domain out of things people actually paste", () => {
    for (const input of [
      "https://send.jslandscapingmd.com/",
      "jordan@send.jslandscapingmd.com",
      "  SEND.JSLandscapingMD.com  ",
      "send.jslandscapingmd.com.",
    ]) {
      expect(parseHostname(input)?.hostname).toBe("send.jslandscapingmd.com");
    }
  });

  it("refuses things that are not hostnames", () => {
    for (const bad of ["", "localhost", "no spaces.com", "-bad.com", "a..b.com", ".com"]) {
      expect(parseHostname(bad)).toBeNull();
    }
  });

  it("handles several levels of subdomain", () => {
    expect(parseHostname("a.b.example.com")).toMatchObject({
      root: "example.com",
      subdomain: "a.b",
    });
  });
});

describe("checkSendingDomain", () => {
  it("refuses the root domain and says what to use instead", () => {
    const verdict = checkSendingDomain("jslandscapingmd.com", "marketing");
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) {
      expect(verdict.reason).toMatch(/news\.jslandscapingmd\.com/);
      expect(verdict.reason).toMatch(/invoices/);
    }
  });

  it("refuses the root for transactional too — nothing sends from the root", () => {
    const verdict = checkSendingDomain("jslandscapingmd.com", "transactional");
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.reason).toMatch(/send\.jslandscapingmd\.com/);
  });

  it("accepts a subdomain", () => {
    expect(checkSendingDomain("news.jslandscapingmd.com", "marketing").ok).toBe(true);
  });

  it("refuses a domain already set up for the same stream", () => {
    const verdict = checkSendingDomain("news.x.com", "marketing", [
      { hostname: "news.x.com", stream: "marketing" },
    ]);
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.reason).toMatch(/already set up/);
  });

  it("refuses reusing the transactional domain for marketing", () => {
    const verdict = checkSendingDomain("send.x.com", "marketing", [
      { hostname: "send.x.com", stream: "transactional" },
    ]);
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.reason).toMatch(/Keep the two apart/);
  });

  it("lets two different subdomains of one root coexist", () => {
    const existing = [{ hostname: "send.x.com", stream: "transactional" as MailStream }];
    expect(checkSendingDomain("news.x.com", "marketing", existing).ok).toBe(true);
  });

  it("refuses nonsense", () => {
    expect(checkSendingDomain("not a domain", "marketing").ok).toBe(false);
  });
});

describe("suggestSubdomain", () => {
  it("uses different words for the two streams", () => {
    const t = suggestSubdomain("x.com", "transactional");
    const m = suggestSubdomain("x.com", "marketing");
    expect(t).toBe("send.x.com");
    expect(m).toBe("news.x.com");
    expect(t).not.toBe(m);
  });
});

describe("checkSenderAddress", () => {
  it("accepts an address on the verified domain", () => {
    expect(checkSenderAddress("jordan@send.x.com", "send.x.com").ok).toBe(true);
  });

  it("refuses an address on the root when the subdomain is what we verified", () => {
    const verdict = checkSenderAddress("jordan@x.com", "send.x.com");
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.reason).toMatch(/@send\.x\.com/);
  });

  it("is case-insensitive about the domain", () => {
    expect(checkSenderAddress("Jordan@Send.X.com", "send.x.com").ok).toBe(true);
  });

  it("refuses malformed addresses", () => {
    for (const bad of ["", "jordan", "@send.x.com", "jordan@", "jor dan@send.x.com"]) {
      expect(checkSenderAddress(bad, "send.x.com").ok).toBe(false);
    }
  });

  it("allows a plus tag", () => {
    expect(checkSenderAddress("jordan+quotes@send.x.com", "send.x.com").ok).toBe(true);
  });
});

describe("normaliseAddress", () => {
  it("collapses two spellings of one address", () => {
    expect(normaliseAddress("  Jordan@Send.X.com ")).toBe(normaliseAddress("jordan@send.x.com"));
  });
});

describe("describeStatus", () => {
  it("says it is ready when verified", () => {
    expect(describeStatus("verified", [])).toMatch(/can send/);
  });

  it("counts the records still outstanding", () => {
    const text = describeStatus("pending", [
      { type: "TXT", name: "a", value: "1", status: "verified" },
      { type: "TXT", name: "b", value: "2", status: "pending" },
    ]);
    expect(text).toMatch(/Waiting on 1 DNS record\b/);
  });

  it("falls back to a useful sentence with no per-record detail", () => {
    expect(describeStatus("pending", [])).toMatch(/Add the records below/);
  });

  it("tells them to look at the records when it failed", () => {
    expect(describeStatus("failed", [])).toMatch(/match exactly/);
  });
});

describe("canRecheck", () => {
  it("is offered until it is verified", () => {
    expect(canRecheck("pending")).toBe(true);
    expect(canRecheck("failed")).toBe(true);
    expect(canRecheck("verified")).toBe(false);
  });
});

describe("domainForStream", () => {
  const domains: { hostname: string; stream: MailStream; status: DomainStatus }[] = [
    { hostname: "send.x.com", stream: "transactional", status: "verified" },
    { hostname: "news.x.com", stream: "marketing", status: "pending" },
  ];

  it("finds the verified domain for a stream", () => {
    expect(domainForStream(domains, "transactional")?.hostname).toBe("send.x.com");
  });

  it("never falls back to the other stream's domain", () => {
    // The marketing domain is not verified. Sending the campaign from the
    // invoice domain instead is exactly what the split exists to prevent.
    expect(domainForStream(domains, "marketing")).toBeNull();
  });

  it("returns nothing when there is nothing set up", () => {
    expect(domainForStream([], "transactional")).toBeNull();
  });
});
