import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import { fbcFromClickId, hashEmail, hashPhone, metaEndpoint, metaEvent } from "@/lib/meta-capi";

const sha = (v: string) => createHash("sha256").update(v).digest("hex");
const at = new Date("2026-10-02T18:00:00Z");

describe("telling Meta about a buyer", () => {
  it("hashes the email trimmed and lowercased", () => {
    expect(hashEmail("  Alex@Example.COM ")).toBe(sha("alex@example.com"));
    expect(hashEmail("not an email")).toBeNull();
  });

  it("hashes a US phone with its country code", () => {
    expect(hashPhone("(410) 555-0100")).toBe(sha("14105550100"));
    expect(hashPhone("+1 410 555 0100")).toBe(sha("14105550100"));
    expect(hashPhone("555-0100")).toBeNull();
  });

  it("never sends the email or phone in the clear", () => {
    const body = JSON.stringify(metaEvent({ name: "Lead", eventId: "o1:lead", at, sourceUrl: "https://x.test/mow", email: "alex@example.com", phone: "4105550100" }));
    expect(body).not.toContain("alex@example.com");
    expect(body).not.toContain("4105550100");
  });

  it("carries the value on a purchase and not on a lead", () => {
    const purchase = metaEvent({ name: "Purchase", eventId: "o1:purchase", at, sourceUrl: "https://x.test/mow", email: "a@b.co", phone: "4105550100", valueCents: 4600 });
    expect(purchase.custom_data).toEqual({ currency: "USD", value: 46 });
    expect(purchase.event_time).toBe(1790964000);
    expect(purchase.action_source).toBe("website");
    const lead = metaEvent({ name: "Lead", eventId: "o1:lead", at, sourceUrl: "https://x.test/mow", email: "a@b.co", phone: "4105550100", valueCents: 4600 });
    expect("custom_data" in lead).toBe(false);
  });

  it("passes the ad click id through so Meta can match the sale to the ad", () => {
    const fbc = fbcFromClickId("IwAR1abcDEF_ghi-jkl", at)!;
    expect(fbc).toBe(`fb.1.${at.getTime()}.IwAR1abcDEF_ghi-jkl`);
    const e = metaEvent({ name: "Lead", eventId: "x", at, sourceUrl: "u", email: "a@b.co", phone: "4105550100", fbc });
    expect(e.user_data.fbc).toBe(fbc);
    expect(fbcFromClickId("<script>", at)).toBeNull();
  });

  it("stays off until a pixel and a token are set", () => {
    expect(metaEndpoint(undefined, "t")).toBeNull();
    expect(metaEndpoint("123456789012345", undefined)).toBeNull();
    expect(metaEndpoint("123456789012345", "tok")).toBe("https://graph.facebook.com/v21.0/123456789012345/events?access_token=tok");
  });
});
