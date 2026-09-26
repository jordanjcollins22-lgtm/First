import { describe, expect, it } from "vitest";

import { creditFor, isSold, rankClosers, type SoldJobInput } from "./affiliate-closes";

function job(over: Partial<SoldJobInput>): SoldJobInput {
  return {
    id: "j",
    status: "approved",
    declined: false,
    soldFor: 1000,
    proposalAccepted: true,
    referralCode: null,
    referredBy: null,
    assignedTo: null,
    accountManager: null,
    closedAt: "2026-09-20T00:00:00Z",
    ...over,
  };
}

const posters = new Map([["abc1234", "affiliate"]]);

describe("who closed a job", () => {
  it("credits the affiliate whose link brought it in, before anybody else", () => {
    expect(creditFor(job({ referralCode: "abc1234", assignedTo: "jace", accountManager: "jace" }), posters)).toBe("affiliate");
  });
  it("then whoever it is assigned to, then the account manager", () => {
    expect(creditFor(job({ assignedTo: "jordan", accountManager: "jace" }), posters)).toBe("jordan");
    expect(creditFor(job({ accountManager: "jace" }), posters)).toBe("jace");
    expect(creditFor(job({}), posters)).toBeNull();
  });
  it("counts only sold work", () => {
    expect(isSold(job({ status: "estimating", proposalAccepted: false }))).toBe(false);
    expect(isSold(job({ declined: true }))).toBe(false);
    expect(isSold(job({ status: "estimating", proposalAccepted: true }))).toBe(true);
  });
});

describe("rankClosers", () => {
  it("lists everybody, sold or not, and counts what nobody is credited with", () => {
    const people = [
      { id: "jace", name: "Jace" },
      { id: "jordan", name: "Jordan" },
      { id: "max", name: "Max" },
    ];
    const { standings, unclaimed } = rankClosers(
      people,
      [
        job({ id: "1", assignedTo: "jace", soldFor: 2000 }),
        job({ id: "2", assignedTo: "jordan", soldFor: 5000, closedAt: "2026-06-01T00:00:00Z" }),
        job({ id: "3", soldFor: 650 }),
      ],
      posters,
      new Map([["max", 4]]),
      new Date("2026-09-26T00:00:00Z")
    );
    expect(standings.map((s) => [s.name, s.closed, s.closedValue, s.monthValue])).toEqual([
      ["Jordan", 1, 5000, 0],
      ["Jace", 1, 2000, 2000],
      ["Max", 0, 0, 0],
    ]);
    expect(unclaimed).toEqual({ closed: 1, value: 650 });
  });
});
