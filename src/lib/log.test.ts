import { afterEach, describe, expect, it, vi } from "vitest";

import { describeError, log, maskEmail, maskPhone, redact } from "@/lib/log";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("nothing secret is written down", () => {
  it("replaces any field that sounds like a secret, however it is spelled", () => {
    const out = redact({
      apiKey: "abc",
      api_key: "abc",
      SUPABASE_SERVICE_ROLE_KEY: "abc",
      authorization: "Bearer x",
      stripeWebhookSecret: "whsec_1",
      nested: { token: "t", fine: "yes" },
      jobId: "j1",
    }) as Record<string, unknown>;
    expect(out.apiKey).toBe("[redacted]");
    expect(out.api_key).toBe("[redacted]");
    expect(out.SUPABASE_SERVICE_ROLE_KEY).toBe("[redacted]");
    expect(out.authorization).toBe("[redacted]");
    expect(out.stripeWebhookSecret).toBe("[redacted]");
    expect((out.nested as Record<string, unknown>).token).toBe("[redacted]");
    expect((out.nested as Record<string, unknown>).fine).toBe("yes");
    expect(out.jobId).toBe("j1");
  });

  it("replaces a value that looks like a key whatever it is called", () => {
    expect(redact({ note: "sk_live_abcdefghijklmnop" })).toEqual({ note: "[redacted]" });
    expect(redact({ note: "key sk_live_abcdefghijklmnop was refused" })).toEqual({ note: "key [redacted] was refused" });
    expect(redact({ note: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxIn0.x" })).toEqual({ note: "[redacted]" });
    expect(redact({ note: "Bearer abc" })).toEqual({ note: "[redacted]" });
    expect(redact({ note: "a plain note" })).toEqual({ note: "a plain note" });
  });

  it("keeps an error's message but scrubs a key inside it and cuts the stack short", () => {
    const err = new Error("Request failed with key sk_live_abcdefghijklmnop");
    const out = describeError(err);
    expect(out.message).not.toContain("sk_live");
    expect(out.name).toBe("Error");
    expect((out.stack ?? "").split("\n").length).toBeLessThanOrEqual(8);
  });

  it("writes one JSON line with the event and level", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    log.info("booking.created", { jobId: "j1", token: "nope" });
    const line = JSON.parse(spy.mock.calls[0][0] as string);
    expect(line.event).toBe("booking.created");
    expect(line.level).toBe("info");
    expect(line.jobId).toBe("j1");
    expect(line.token).toBe("[redacted]");
    expect(typeof line.t).toBe("string");
  });

  it("puts an error under error with its fields beside it", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    log.error("email.failed", new Error("boom"), { customerId: "c1" });
    const line = JSON.parse(spy.mock.calls[0][0] as string);
    expect(line.error.message).toBe("boom");
    expect(line.customerId).toBe("c1");
  });

  it("masks who a message went to", () => {
    expect(maskEmail("deanna.perusse@gmail.com")).toBe("d***@gmail.com");
    expect(maskPhone("+14438191521")).toBe("+1443***1521");
    expect(maskEmail(null)).toBeNull();
  });
});
