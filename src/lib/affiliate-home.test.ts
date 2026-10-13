import { describe, expect, it } from "vitest";

import { affiliateMoney, affiliateResults, privateBoard } from "@/lib/affiliate-home";
import type { BoardPost } from "@/lib/data/post-board";
import type { BroughtInRow } from "@/lib/brought-in";
import type { CommissionSummary } from "@/lib/commission";

const answer = (over: Partial<BoardPost["others"][number]> = {}): BoardPost["others"][number] => ({
  id: "a1",
  profileId: "p-other",
  name: "Sam",
  status: "posted",
  comment: "Sam's own words https://x/r/SAMCODE",
  code: "SAMCODE",
  clicks: 9,
  createdAt: "2026-10-01T00:00:00Z",
  updatedAt: "2026-10-01T00:00:00Z",
  postedAt: "2026-10-01T00:00:00Z",
  ...over,
});

const post = (others: BoardPost["others"], mine: BoardPost["mine"] = null): BoardPost => ({
  id: "post1",
  link: "https://facebook.com/x",
  hasUrl: true,
  groupName: "Bel Air",
  author: "Pat",
  text: "Anyone do mulch?",
  ageDays: 0,
  foundAt: "2026-10-01T00:00:00Z",
  pile: "open",
  mine,
  others,
  platform: "facebook",
  postedAt: null,
  matchReason: null,
  addedByHand: false,
  draft: null,
  ageLabel: "Posted today",
  freshness: "fresh",
  ageHint: "",
});

describe("privateBoard", () => {
  it("keeps who else answered, but never their comment, code or clicks", () => {
    const [p] = privateBoard([post([answer()])]);
    expect(p.others).toHaveLength(1);
    expect(p.others[0].name).toBe("Sam");
    expect(p.others[0].status).toBe("posted");
    expect(p.others[0].comment).toBeNull();
    expect(p.others[0].code).toBeNull();
    expect(p.others[0].clicks).toBe(0);
    expect(p.others[0].profileId).toBe("");
    expect(JSON.stringify(p)).not.toContain("SAMCODE");
  });

  it("leaves the viewer's own answer alone", () => {
    const mine = answer({ id: "m1", profileId: "me", comment: "mine", code: "MYCODE", clicks: 3 });
    const [p] = privateBoard([post([], mine)]);
    expect(p.mine).toEqual(mine);
  });
});

describe("affiliateResults", () => {
  const row = (step: BroughtInRow["step"]): BroughtInRow => ({
    jobId: step,
    client: "C",
    address: "",
    jobStatus: "",
    evaluationDate: null,
    proposalStatus: null,
    price: null,
    createdAt: "",
    step,
    label: "",
    yours: null,
  });

  it("adds up clicks and counts what was booked and what sold", () => {
    expect(affiliateResults([2, null, 5, undefined], [row("lead"), row("sold"), row("done"), row("lost")])).toEqual({
      clicks: 7,
      booked: 4,
      sold: 2,
    });
  });

  it("is all zeros with nothing out yet", () => {
    expect(affiliateResults([], [])).toEqual({ clicks: 0, booked: 0, sold: 0 });
  });
});

describe("affiliateMoney", () => {
  it("splits what they earned into paid and still owed", () => {
    const summary = { pct: 4, lines: [], earned: 40, held: 10, accruing: 5.5, paid: 100 } as CommissionSummary;
    expect(affiliateMoney(summary)).toEqual({ earned: 155.5, paid: 100, owed: 55.5 });
  });

  it("is zero when the book couldn't be read", () => {
    expect(affiliateMoney(null)).toEqual({ earned: 0, paid: 0, owed: 0 });
  });
});
