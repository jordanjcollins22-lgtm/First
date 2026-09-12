import { describe, expect, it } from "vitest";

import { HANDLED_EVENTS, needsAttention, pointsAtUs, webhookVerdict } from "@/lib/webhook-health";

const OURS = "https://app.jslandscapingmd.com/api/webhooks/stripe";

function endpoint(overrides: Partial<{ url: string; status: string; enabledEvents: string[] }> = {}) {
  return {
    url: OURS,
    status: "enabled",
    enabledEvents: [...HANDLED_EVENTS],
    ...overrides,
  };
}

describe("webhookVerdict", () => {
  it("says so when there is nothing on the account pointing at us", () => {
    // What was actually true: a working key, money arriving, and no endpoint.
    const verdict = webhookVerdict({ configured: true, secretSet: true, ourUrl: OURS, endpoints: [] });
    expect(verdict.state).toBe("missing");
    expect(verdict.message).toMatch(/tells nobody/);
    expect(verdict.message).toContain(OURS);
  });

  it("is happy with an enabled endpoint, a secret, and every event", () => {
    const verdict = webhookVerdict({
      configured: true,
      secretSet: true,
      ourUrl: OURS,
      endpoints: [endpoint()],
    });
    expect(verdict.state).toBe("ok");
    expect(verdict.message).toBeNull();
    expect(needsAttention(verdict)).toBe(false);
  });

  it("does not count somebody else's endpoint as ours", () => {
    const verdict = webhookVerdict({
      configured: true,
      secretSet: true,
      ourUrl: OURS,
      endpoints: [endpoint({ url: "https://services.leadconnectorhq.com/stripe" })],
    });
    expect(verdict.state).toBe("missing");
  });

  it("calls out an endpoint Stripe has switched off", () => {
    const verdict = webhookVerdict({
      configured: true,
      secretSet: true,
      ourUrl: OURS,
      endpoints: [endpoint({ status: "disabled" })],
    });
    expect(verdict.state).toBe("disabled");
    expect(needsAttention(verdict)).toBe(true);
  });

  it("prefers the live endpoint over an old disabled one", () => {
    const verdict = webhookVerdict({
      configured: true,
      secretSet: true,
      ourUrl: OURS,
      endpoints: [endpoint({ status: "disabled" }), endpoint()],
    });
    expect(verdict.state).toBe("ok");
  });

  it("says the deployment has no secret when the endpoint exists but we cannot verify it", () => {
    // Every delivery comes back 403 and Stripe retries into the void.
    const verdict = webhookVerdict({
      configured: true,
      secretSet: false,
      ourUrl: OURS,
      endpoints: [endpoint()],
    });
    expect(verdict.state).toBe("no_secret");
    expect(verdict.message).toMatch(/STRIPE_WEBHOOK_SECRET/);
  });

  it("names the events the endpoint is not subscribed to", () => {
    const verdict = webhookVerdict({
      configured: true,
      secretSet: true,
      ourUrl: OURS,
      endpoints: [endpoint({ enabledEvents: ["checkout.session.completed"] })],
    });
    expect(verdict.state).toBe("ok");
    expect(verdict.missingEvents).toContain("invoice.paid");
    expect(verdict.message).toMatch(/not subscribed/);
    expect(needsAttention(verdict)).toBe(true);
  });

  it("accepts a subscription to everything", () => {
    const verdict = webhookVerdict({
      configured: true,
      secretSet: true,
      ourUrl: OURS,
      endpoints: [endpoint({ enabledEvents: ["*"] })],
    });
    expect(verdict.missingEvents).toEqual([]);
  });

  it("has nothing to say about a business with no Stripe at all", () => {
    const verdict = webhookVerdict({ configured: false, secretSet: false, ourUrl: OURS, endpoints: [] });
    expect(verdict.state).toBe("unconfigured");
    expect(needsAttention(verdict)).toBe(false);
  });
});

describe("pointsAtUs", () => {
  it("ignores scheme, case and a trailing slash", () => {
    expect(pointsAtUs("HTTP://App.JsLandscapingMD.com/api/webhooks/stripe/", OURS)).toBe(true);
  });

  it("does not match a different path on our own domain", () => {
    expect(pointsAtUs("https://app.jslandscapingmd.com/api/webhooks/plaid", OURS)).toBe(false);
  });
});
