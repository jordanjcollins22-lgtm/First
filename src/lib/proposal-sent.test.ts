import { describe, expect, it } from "vitest";

import { proposalShortLabel, proposalStatusLabel, proposalStatusTone, wasSent } from "./proposal-sent";

describe("wasSent", () => {
  it("is sent only once the email went, or the client answered", () => {
    expect(wasSent("sent", null)).toBe(false);
    expect(wasSent("sent", "2026-09-21T15:30:00Z")).toBe(true);
    expect(wasSent("sent", undefined)).toBe(true);
    expect(wasSent("accepted", null)).toBe(true);
    expect(wasSent("needs_approval", null)).toBe(false);
  });
});

describe("labels", () => {
  it("say approved until it goes", () => {
    expect(proposalStatusLabel("sent", null)).toBe("Approved, not sent yet");
    expect(proposalStatusLabel("sent", "2026-09-21T15:30:00Z")).toBe("Sent, awaiting response");
    expect(proposalShortLabel("sent", null)).toBe("Proposal approved, not sent");
    expect(proposalShortLabel("sent", "x")).toBe("Proposal sent");
  });
  it("colour waiting-on-us amber and waiting-on-them blue", () => {
    expect(proposalStatusTone("sent", null)).toBe("amber");
    expect(proposalStatusTone("sent", "x")).toBe("blue");
    expect(proposalStatusTone("accepted", null)).toBe("good");
  });
});
