import { describe, expect, it } from "vitest";

import {
  involvesPartner,
  joinList,
  summariseCrewing,
  whoAttendsAnswer,
  type CrewingLine,
} from "./who-attends";

function own(serviceLabel: string): CrewingLine {
  return { serviceLabel, performedBy: "own" };
}
function partner(serviceLabel: string, partnerName?: string | null): CrewingLine {
  return { serviceLabel, performedBy: "partner", partnerName };
}

describe("summariseCrewing", () => {
  it("is ours when every service is ours", () => {
    const c = summariseCrewing([own("Mulch"), own("Mowing")]);
    expect(c.kind).toBe("own");
    expect(c.ownServices).toEqual(["Mulch", "Mowing"]);
    expect(c.partnerServices).toEqual([]);
  });

  it("is a partner's when all of it goes out", () => {
    const c = summariseCrewing([partner("Tree Removal", "Harford Tree Co")]);
    expect(c.kind).toBe("partner");
    expect(c.partnerServices).toEqual([{ partner: "Harford Tree Co", services: ["Tree Removal"] }]);
  });

  it("is mixed when some of it goes out", () => {
    const c = summariseCrewing([own("Mulch"), partner("Tree Removal", "Harford Tree Co")]);
    expect(c.kind).toBe("mixed");
    expect(c.ownServices).toEqual(["Mulch"]);
    expect(c.partnerServices).toHaveLength(1);
  });

  it("is nothing when nothing is priced yet", () => {
    expect(summariseCrewing([]).kind).toBe("none");
  });

  it("collapses a service that appears in several zones", () => {
    // Mulch in four beds is still one thing the client is being told about.
    const c = summariseCrewing([own("Mulch"), own("Mulch"), own("Mulch")]);
    expect(c.ownServices).toEqual(["Mulch"]);
  });

  it("groups two services under one partner", () => {
    const c = summariseCrewing([
      partner("Tree Removal", "Harford Tree Co"),
      partner("Stump Grinding", "Harford Tree Co"),
    ]);
    expect(c.partnerServices).toEqual([
      { partner: "Harford Tree Co", services: ["Tree Removal", "Stump Grinding"] },
    ]);
  });

  it("keeps two different partners apart", () => {
    const c = summariseCrewing([
      partner("Tree Removal", "Harford Tree Co"),
      partner("Irrigation", "Bel Air Irrigation"),
    ]);
    expect(c.partnerServices).toHaveLength(2);
  });

  it("still says somebody else is coming when the partner has no name on file", () => {
    // The worst outcome is a client told it is our crew and then meeting a
    // truck they do not recognise.
    const c = summariseCrewing([partner("Tree Removal", null)]);
    expect(c.kind).toBe("partner");
    expect(c.partnerServices[0].partner).toMatch(/local business/i);
  });

  it("ignores a blank service label", () => {
    expect(summariseCrewing([own("  "), partner("", "X")]).kind).toBe("none");
  });
});

describe("whoAttendsAnswer", () => {
  it("says it is our crew when it is", () => {
    const answer = whoAttendsAnswer(summariseCrewing([own("Mulch")]));
    expect(answer).toMatch(/our own crew/i);
    // Nobody else is on this job, so nobody else gets named.
    expect(answer).not.toMatch(/will be doing the/i);
  });

  it("says what happens to work we do not do in house, even on an all ours job", () => {
    // A client comparing quotes wants to know who has a go at the thing we
    // are not set up for. "All of it ourselves" is the worrying answer.
    for (const lines of [[own("Mulch")], []]) {
      const answer = whoAttendsAnswer(summariseCrewing(lines));
      expect(answer).toMatch(/licensed and insured partner/i);
      expect(answer).toMatch(/in house/i);
    }
  });

  it("says a partner is licensed and hired for it, not just somebody we know", () => {
    for (const lines of [
      [partner("Tree Removal", "Harford Tree Co")],
      [own("Mulch"), partner("Tree Removal", "Harford Tree Co")],
    ]) {
      const answer = whoAttendsAnswer(summariseCrewing(lines));
      expect(answer).toMatch(/licensed and insured/i);
      expect(answer).toMatch(/we hire them/i);
    }
  });

  it("names the partner when the whole job goes out", () => {
    const answer = whoAttendsAnswer(summariseCrewing([partner("Tree Removal", "Harford Tree Co")]));
    expect(answer).toContain("Harford Tree Co");
    expect(answer).toMatch(/tree removal/i);
  });

  it("splits it honestly when the job is mixed", () => {
    const answer = whoAttendsAnswer(
      summariseCrewing([own("Mulch"), partner("Tree Removal", "Harford Tree Co")])
    );
    expect(answer).toMatch(/our own crew/i);
    expect(answer).toContain("Harford Tree Co");
    expect(answer).toMatch(/mulch/i);
  });

  it("never claims it is all ours when a partner is on the job", () => {
    // The specific lie the old flat answer told.
    const answer = whoAttendsAnswer(
      summariseCrewing([own("Mulch"), partner("Tree Removal", "Harford Tree Co")])
    );
    expect(answer).not.toMatch(/not subcontractors/i);
  });

  it("still says who is responsible when work goes out", () => {
    const answer = whoAttendsAnswer(summariseCrewing([partner("Tree Removal", "Harford Tree Co")]));
    expect(answer).toMatch(/responsible/i);
  });

  it("falls back to our crew with nothing priced", () => {
    expect(whoAttendsAnswer(summariseCrewing([]))).toMatch(/our own crew/i);
  });

  it("uses no dashes", () => {
    for (const lines of [[own("Mulch")], [partner("Tree", "X")], [own("Mulch"), partner("Tree", "X")]]) {
      expect(whoAttendsAnswer(summariseCrewing(lines))).not.toMatch(/[—–]/);
    }
  });
});

describe("joinList", () => {
  it("reads the way somebody would say it", () => {
    expect(joinList([])).toBe("");
    expect(joinList(["a"])).toBe("a");
    expect(joinList(["a", "b"])).toBe("a and b");
    expect(joinList(["a", "b", "c"])).toBe("a, b and c");
  });
});

describe("involvesPartner", () => {
  it("is true whenever somebody else is coming", () => {
    expect(involvesPartner(summariseCrewing([partner("Tree", "X")]))).toBe(true);
    expect(involvesPartner(summariseCrewing([own("Mulch"), partner("Tree", "X")]))).toBe(true);
  });

  it("is false for our own work", () => {
    expect(involvesPartner(summariseCrewing([own("Mulch")]))).toBe(false);
    expect(involvesPartner(summariseCrewing([]))).toBe(false);
  });
});
