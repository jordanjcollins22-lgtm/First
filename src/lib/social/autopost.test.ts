import { describe, expect, it } from "vitest";

import { afterFailure, classifyPublishError, describeHealth, isStale, MAX_ATTEMPTS, NOT_CONNECTED, reachable, stillToSend, tidyResults, type HealthInput } from "./autopost";

const NOW = new Date("2026-11-12T15:00:00Z");

describe("classifyPublishError", () => {
  it("an expired key is not retried", () => {
    expect(classifyPublishError({ code: 190, message: "Error validating access token: Session has expired" })).toMatchObject({ kind: "auth", retry: false });
    expect(classifyPublishError({ message: "Invalid OAuth access token." })).toMatchObject({ kind: "auth", retry: false });
  });
  it("a missing permission is not retried", () => {
    expect(classifyPublishError({ code: 10, message: "Application does not have permission for this action" })).toMatchObject({ kind: "permission", retry: false });
    expect(classifyPublishError({ code: 200, message: "(#200) The user hasn't authorized the application to perform this action" }).kind).toBe("permission");
  });
  it("a picture Meta can't use is not retried", () => {
    expect(classifyPublishError({ code: 9004, message: "Only photo or video can be accepted as media type." })).toMatchObject({ kind: "media", retry: false });
    expect(classifyPublishError({ code: 2207026, message: "Unsupported format" }).kind).toBe("media");
  });
  it("busy or rate limited is retried", () => {
    expect(classifyPublishError({ code: 4, status: 400, message: "Application request limit reached" })).toMatchObject({ kind: "transient", retry: true });
    expect(classifyPublishError({ status: 503, message: "Service temporarily unavailable" }).retry).toBe(true);
  });
  it("names the account in the reason", () => {
    expect(classifyPublishError({ code: 190, platform: "instagram", message: "expired" }).reason).toMatch(/^Instagram:/);
  });
});

describe("afterFailure", () => {
  it("backs off 15 min, 1 h, 4 h, then stops", () => {
    const t = classifyPublishError({ code: 4, message: "busy" });
    expect(afterFailure(0, t, NOW)).toEqual({ status: "scheduled", attempts: 1, nextAttemptAt: "2026-11-12T15:15:00.000Z" });
    expect(afterFailure(1, t, NOW).nextAttemptAt).toBe("2026-11-12T16:00:00.000Z");
    expect(afterFailure(2, t, NOW).nextAttemptAt).toBe("2026-11-12T19:00:00.000Z");
    expect(afterFailure(MAX_ATTEMPTS - 1, t, NOW)).toEqual({ status: "failed", attempts: MAX_ATTEMPTS, nextAttemptAt: null });
  });
  it("stops at once when retrying can't help", () => {
    expect(afterFailure(0, classifyPublishError({ code: 190, message: "expired" }), NOW).status).toBe("failed");
  });
});

describe("isStale", () => {
  it("only an untried post more than two days late", () => {
    expect(isStale({ scheduledFor: "2026-11-10T13:00:00Z", attempts: 0 }, NOW)).toBe(true);
    expect(isStale({ scheduledFor: "2026-11-10T13:00:00Z", attempts: 1 }, NOW)).toBe(false);
    expect(isStale({ scheduledFor: "2026-11-12T05:00:00Z", attempts: 0 }, NOW)).toBe(false);
    expect(isStale({ scheduledFor: null, attempts: 0 }, NOW)).toBe(false);
  });
});

describe("what is left to send", () => {
  it("skips accounts that already have it", () => {
    const results = tidyResults({ facebook: { id: "1_2", at: "x" }, webhook: { id: "handoff", at: "x" }, instagram: "junk" });
    expect(results).toEqual({ facebook: { id: "1_2", at: "x" } });
    expect(stillToSend(["facebook", "instagram"], results)).toEqual(["instagram"]);
  });
  it("splits reachable from not connected", () => {
    expect(reachable(["facebook", "instagram"], { facebook: true, instagram: false, webhook: false })).toEqual({ send: ["facebook"], blocked: ["instagram"] });
  });
});

describe("describeHealth", () => {
  const base: HealthInput = {
    migrationApplied: true,
    connection: { facebook: true, instagram: true, webhook: false },
    lastPostedAt: "2026-11-10T15:00:00Z",
    lastPostedChannel: "facebook+instagram",
    nextAt: "2026-11-14T14:00:00Z",
    scheduledCount: 3,
    approvedWaiting: 0,
    drafts: 2,
    failed: [],
    retrying: [],
    overdue: 0,
    lastRunAt: "2026-11-12T14:05:00Z",
    now: NOW,
  };
  const when = (iso: string) => iso.slice(0, 10);

  it("good when connected with a next post", () => {
    const h = describeHealth(base, when);
    expect(h.tone).toBe("good");
    expect(h.headline).toBe("Posting works. Next post 2026-11-14.");
    expect(h.lines).toContain("Last posted 2026-11-10 (facebook+instagram).");
  });
  it("says what is wrong when nothing is connected", () => {
    const h = describeHealth({ ...base, connection: { facebook: false, instagram: false, webhook: false } }, when);
    expect(h.tone).toBe("bad");
    expect(h.failingBecause).toBe(NOT_CONNECTED.reason);
  });
  it("puts the missing migration first", () => {
    expect(describeHealth({ ...base, migrationApplied: false }, when).failingBecause).toMatch(/0374_social_autopost/);
  });
  it("shows the last failure", () => {
    const h = describeHealth({ ...base, failed: [{ error: "Facebook: key expired", at: "x" }] }, when);
    expect(h).toMatchObject({ tone: "bad", failingBecause: "Facebook: key expired" });
  });
  it("warns on retries and when nothing is scheduled", () => {
    expect(describeHealth({ ...base, retrying: [{ error: "busy", nextAttemptAt: null }] }, when).tone).toBe("warn");
    expect(describeHealth({ ...base, nextAt: null }, when).headline).toMatch(/nothing is scheduled/);
  });
  it("flags Instagram not linked", () => {
    expect(describeHealth({ ...base, connection: { facebook: true, instagram: false, webhook: false } }, when).lines.join(" ")).toMatch(/Instagram isn't linked/);
  });
});
