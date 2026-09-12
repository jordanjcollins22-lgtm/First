import { describe, expect, it } from "vitest";

import { allFound, fullName, judge, summariseLookups } from "@/lib/dns-check";
import type { DnsRecord } from "@/lib/sending-domains";

const AT = "2026-09-12T15:00:00Z";
const DKIM = "p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQC7xyz1234567890abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789abcdefghij";

describe("fullName", () => {
  it("puts the root back on the provider's relative names", () => {
    expect(fullName("send", "send.jslandscapingmd.com")).toBe("send.jslandscapingmd.com");
    expect(fullName("resend._domainkey.send", "send.jslandscapingmd.com")).toBe("resend._domainkey.send.jslandscapingmd.com");
    expect(fullName("_dmarc", "news.jslandscapingmd.com")).toBe("_dmarc.jslandscapingmd.com");
  });

  it("leaves a name alone when it already carries the root", () => {
    expect(fullName("send.jslandscapingmd.com.", "send.jslandscapingmd.com")).toBe("send.jslandscapingmd.com");
    expect(fullName("@", "send.jslandscapingmd.com")).toBe("jslandscapingmd.com");
  });
});

describe("judge", () => {
  const txt: DnsRecord = { type: "TXT", name: "send", value: "v=spf1 include:amazonses.com ~all" };
  const mx: DnsRecord = { type: "MX", name: "send", value: "feedback-smtp.us-east-1.amazonses.com", priority: 10 };
  const dkim: DnsRecord = { type: "TXT", name: "resend._domainkey.send", value: DKIM };

  it("says not found yet when the name resolves to nothing", () => {
    expect(judge(txt, { values: [], error: "ENOTFOUND" }, AT).state).toBe("missing");
    expect(judge(txt, { values: [], error: "ENODATA" }, AT).state).toBe("missing");
  });

  it("reports a resolver failure as something to retry, not as missing", () => {
    expect(judge(txt, { values: [], error: "ETIMEOUT" }, AT).state).toBe("error");
  });

  it("finds a TXT record whatever the host did to its quotes, case and chunks", () => {
    expect(judge(txt, { values: ['"V=SPF1 include:amazonses.com ~all"'] }, AT).state).toBe("found");
    const chunked = `"${DKIM.slice(0, 60)}" "${DKIM.slice(60)}"`;
    expect(judge(dkim, { values: [chunked] }, AT).state).toBe("found");
  });

  it("finds ours among several TXT records on the same name", () => {
    expect(judge(txt, { values: ["google-site-verification=abc", "v=spf1 include:amazonses.com ~all"] }, AT).state).toBe("found");
  });

  it("calls a mangled DKIM key a wrong value rather than missing", () => {
    const result = judge(dkim, { values: [DKIM.slice(0, -3)] }, AT);
    expect(result.state).toBe("different");
    expect(result.detail).toMatch(/starts the same/);
  });

  it("checks an MX target and its priority", () => {
    expect(judge(mx, { values: ["feedback-smtp.us-east-1.amazonses.com."], priorities: [10] }, AT).state).toBe("found");
    expect(judge(mx, { values: ["feedback-smtp.us-east-1.amazonses.com"], priorities: [20] }, AT)).toMatchObject({
      state: "different",
      detail: "Found it, but with priority 20 instead of 10.",
    });
    expect(judge(mx, { values: ["mail.other.com"], priorities: [10] }, AT).state).toBe("different");
  });
});

describe("summariseLookups", () => {
  const found = { state: "found" as const, detail: "", at: AT };
  const missing = { state: "missing" as const, detail: "", at: AT };
  const different = { state: "different" as const, detail: "", at: AT };

  it("says nothing before anything has been looked up", () => {
    expect(summariseLookups([{ type: "TXT", name: "a", value: "b" }])).toBeNull();
  });

  it("counts what is there and says what to do about the rest", () => {
    const line = summariseLookups([
      { type: "TXT", name: "a", value: "b", lookup: found },
      { type: "MX", name: "a", value: "c", lookup: missing },
      { type: "TXT", name: "d", value: "e", lookup: different },
    ]);
    expect(line).toBe(
      "1 of 3 records found on the internet. 1 has the wrong value and needs redoing at your host. 1 not there yet: add it if you have not, otherwise give it a few minutes."
    );
  });

  it("tells them to press the provider check once everything is in place", () => {
    const records: DnsRecord[] = [
      { type: "TXT", name: "a", value: "b", lookup: found },
      { type: "MX", name: "a", value: "c", lookup: found },
    ];
    expect(summariseLookups(records)).toMatch(/^Every record is on the internet/);
    expect(allFound(records)).toBe(true);
  });
});
