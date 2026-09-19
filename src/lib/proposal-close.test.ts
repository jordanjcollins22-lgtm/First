import { describe, expect, it } from "vitest";

import { declinedWording, isOpenProposal, OPEN_PROPOSAL_STATUSES } from "./proposal-close";

describe("isOpenProposal", () => {
  it("counts sent and needs approval as still open", () => {
    expect(isOpenProposal("sent")).toBe(true);
    expect(isOpenProposal("needs_approval")).toBe(true);
    expect(OPEN_PROPOSAL_STATUSES).toEqual(["needs_approval", "sent"]);
  });
  it("never closes a contract or re-closes a decline", () => {
    expect(isOpenProposal("accepted")).toBe(false);
    expect(isOpenProposal("declined")).toBe(false);
    expect(isOpenProposal(null)).toBe(false);
  });
});

describe("declinedWording", () => {
  it("does not say the client declined when the office closed it", () => {
    const words = declinedWording({ closedByOffice: true, respondedAt: null });
    expect(words.headline).toMatch(/closed/);
    expect(words.headline).not.toMatch(/You declined/);
    expect(words.detail).toMatch(/reopen/);
  });
  it("keeps the client's own decline in their words", () => {
    expect(declinedWording({ closedByOffice: false, respondedAt: null }).headline).toBe("You declined this proposal.");
  });
  it("uses no dashes", () => {
    for (const closedByOffice of [true, false]) {
      const words = declinedWording({ closedByOffice, respondedAt: "2026-09-11T10:00:00Z" });
      expect(`${words.headline} ${words.detail}`).not.toMatch(/[—–]/);
    }
  });
});
