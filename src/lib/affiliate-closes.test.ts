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
  it("credits the affiliate whose tracked link brought it in", () => {
    expect(creditFor(job({ referralCode: "abc1234", assignedTo: "jace", accountManager: "jace" }), posters)).toBe("affiliate");
  });
  it("or whose own booking link the client used", () => {
    expect(creditFor(job({ referredBy: "cheyenne" }), posters)).toBe("cheyenne");
  });
  it("credits nobody for work that did not come from a link, however it was sold", () => {
    expect(creditFor(job({ assignedTo: "jordan", accountManager: "jace" }), posters)).toBeNull();
  });
  it("counts only sold work as closed", () => {
    expect(isSold(job({ status: "estimating", proposalAccepted: false }))).toBe(false);
    expect(isSold(job({ declined: true }))).toBe(false);
    expect(isSold(job({ status: "estimating", proposalAccepted: true }))).toBe(true);
  });
});

describe("rankClosers", () => {
  it("lists only people who put links out, with what their links booked and closed", () => {
    const people = [
      { id: "affiliate", name: "Ava" },
      { id: "jace", name: "Jace" },
      { id: "max", name: "Max" },
    ];
    const standings = rankClosers(
      people,
      [
        job({ id: "1", referralCode: "abc1234", soldFor: 2000 }),
        job({ id: "2", referralCode: "abc1234", status: "estimating", proposalAccepted: false }),
        job({ id: "3", assignedTo: "jace", soldFor: 9000 }),
      ],
      posters,
      new Map([["affiliate", 5], ["max", 1]]),
      new Map(),
      new Date("2026-09-26T00:00:00Z")
    );
    expect(standings.map((s) => [s.name, s.links, s.booked, s.closed, s.closedValue])).toEqual([
      ["Ava", 5, 2, 1, 2000],
      ["Max", 1, 0, 0, 0],
    ]);
  });
});
