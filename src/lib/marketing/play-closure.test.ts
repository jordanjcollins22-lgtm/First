import { describe, expect, it } from "vitest";

import { costPerLead, decideClosure, isStale, playCostCents, resultsByKind, trailCoverage, unassignedTooLong, type ClosablePlay, type ClosureInput } from "./play-closure";

// Doors 60 m apart along a street (about 0.00054° of latitude each).
const doors = Array.from({ length: 10 }, (_, i) => ({ lat: 39.5 + i * 0.00054, lng: -76.35 }));

const play: ClosablePlay = {
  id: "p",
  kind: "door_hangers",
  status: "open",
  approval: "auto",
  createdAt: "2026-10-01T12:00:00Z",
  approvedAt: "2026-10-01T12:00:00Z",
  assignedAt: null,
  quantity: 10,
};

function input(over: Partial<ClosureInput> = {}): ClosureInput {
  return {
    play,
    doors,
    trail: [],
    crewFinishedAt: null,
    now: new Date("2026-10-05T12:00:00Z"),
    autoCloseSince: "2026-09-01T00:00:00Z",
    expireSince: "2026-09-01T00:00:00Z",
    expiryDays: 30,
    coverageNeeded: 0.8,
    ...over,
  };
}

const walk = (n: number, at = "2026-10-02T15:00:00Z") => doors.slice(0, n).map((d) => ({ lat: d.lat, lng: d.lng + 0.0002, at }));

describe("trailCoverage", () => {
  it("counts a door as reached when the trail came within reach of it", () => {
    expect(trailCoverage(doors, walk(10))).toBe(1);
    expect(trailCoverage(doors, walk(5))).toBe(0.5);
    expect(trailCoverage(doors, [])).toBe(0);
    expect(trailCoverage([], walk(3))).toBe(0);
    // 200 m away across a field is not the round.
    expect(trailCoverage(doors, doors.map((d) => ({ lat: d.lat, lng: d.lng + 0.0025 })))).toBe(0);
  });
});

describe("decideClosure", () => {
  it("closes a round the trail covered", () => {
    const d = decideClosure(input({ trail: walk(9) }));
    expect(d).toMatchObject({ action: "close", reason: "gps" });
  });

  it("leaves a round the trail only touched", () => {
    expect(decideClosure(input({ trail: walk(4) })).action).toBe("none");
  });

  it("ignores a walk from before the play was approved, or before auto-close was on", () => {
    expect(decideClosure(input({ trail: walk(10, "2026-09-30T00:00:00Z") })).action).toBe("none");
    expect(decideClosure(input({ trail: walk(10), autoCloseSince: "2026-10-03T00:00:00Z" })).action).toBe("none");
  });

  it("closes on the crew's finished tap at the play's job, never for flyers", () => {
    expect(decideClosure(input({ crewFinishedAt: "2026-10-03T16:00:00Z" }))).toMatchObject({ action: "close", reason: "crew_finished" });
    expect(decideClosure(input({ play: { ...play, kind: "flyers" }, doors: [], crewFinishedAt: "2026-10-03T16:00:00Z" })).action).toBe("none");
    expect(decideClosure(input({ crewFinishedAt: "2026-09-20T16:00:00Z" })).action).toBe("none");
  });

  it("never closes a play nobody approved", () => {
    expect(decideClosure(input({ play: { ...play, approval: "pending" }, trail: walk(10) })).action).toBe("none");
  });

  it("expires a play with nothing on it for 30 days, with a note", () => {
    const d = decideClosure(input({ now: new Date("2026-11-02T12:00:00Z"), autoCloseSince: null }));
    expect(d.action).toBe("expire");
    if (d.action === "expire") expect(d.note).toMatch(/32 days/);
  });

  it("does not expire the backlog from before expiry was switched on", () => {
    expect(decideClosure(input({ now: new Date("2026-12-01T00:00:00Z"), expireSince: "2026-10-10T00:00:00Z", autoCloseSince: null })).action).toBe("none");
    expect(isStale(play, new Date("2026-12-01T00:00:00Z"), 30)).toBe(true);
    expect(isStale(play, new Date("2026-10-15T00:00:00Z"), 30)).toBe(false);
  });

  it("leaves closed plays alone", () => {
    expect(decideClosure(input({ play: { ...play, status: "done" }, trail: walk(10) })).action).toBe("none");
  });
});

describe("money", () => {
  it("costs a play by its pieces", () => {
    const unit = { yard_sign: 800, knocks: 0, door_hangers: 25, flyers: 45 };
    expect(playCostCents("door_hangers", 100, unit)).toBe(2500);
    expect(playCostCents("yard_sign", 1, unit)).toBe(800);
    expect(playCostCents("flyers", 1016, unit)).toBe(45720);
  });

  it("never divides by nothing", () => {
    expect(costPerLead(2500, 0)).toBeNull();
    expect(costPerLead(2500, 2)).toBe(1250);
  });

  it("adds up cost per lead by kind", () => {
    const r = resultsByKind([
      { kind: "door_hangers", costCents: 2500, leads: 1, sold: 1 },
      { kind: "door_hangers", costCents: 2500, leads: 1, sold: 0 },
      { kind: "flyers", costCents: 45000, leads: 0, sold: 0 },
    ]);
    expect(r.find((k) => k.kind === "door_hangers")).toMatchObject({ plays: 2, costCents: 5000, leads: 2, costPerLeadCents: 2500 });
    expect(r.find((k) => k.kind === "flyers")?.costPerLeadCents).toBeNull();
  });

  it("finds approved plays nobody was given for more than three days", () => {
    const now = new Date("2026-10-10T00:00:00Z");
    const plays = [
      { status: "open", assignedTo: null, approvedAt: "2026-10-01T00:00:00Z", createdAt: "2026-10-01T00:00:00Z" },
      { status: "open", assignedTo: "x", approvedAt: "2026-10-01T00:00:00Z", createdAt: "2026-10-01T00:00:00Z" },
      { status: "open", assignedTo: null, approvedAt: "2026-10-09T00:00:00Z", createdAt: "2026-10-09T00:00:00Z" },
    ];
    expect(unassignedTooLong(plays, now)).toHaveLength(1);
  });
});
