import { describe, expect, it } from "vitest";

import {
  canRecord,
  directionsUrl,
  minutesElapsed,
  readDay,
  type CrewEvent,
  type CrewEventKind,
  type Stop,
} from "@/lib/crew-day";

const STOPS: Stop[] = [
  { jobId: "j1", address: "12 Elm St", customerName: "Pat", lat: 39.5, lng: -76.3, purpose: "Bed rebuild" },
  { jobId: "j2", address: "40 Oak Ave", customerName: "Sam", lat: 39.6, lng: -76.4, purpose: "Mulch" },
];

let clock = 0;
function ev(kind: CrewEventKind, jobId: string | null = null): CrewEvent {
  clock += 60_000;
  return { kind, jobId, at: new Date(1_800_000_000_000 + clock).toISOString() };
}

/** The happy path, up to a given point. */
function upTo(step: number): CrewEvent[] {
  clock = 0;
  const all = [
    ev("arrived_shop"),
    ev("left_shop"),
    ev("travelling", "j1"),
    ev("arrived_job", "j1"),
    ev("finished_job", "j1"),
    ev("travelling", "j2"),
    ev("arrived_job", "j2"),
    ev("finished_job", "j2"),
    ev("returned_shop"),
  ];
  return all.slice(0, step);
}

describe("readDay", () => {
  it("starts by asking them to get to the shop", () => {
    const day = readDay([], STOPS);
    expect(day.phase).toBe("before_shop");
    expect(day.action?.kind).toBe("arrived_shop");
  });

  it("names the first house once they're at the shop", () => {
    const day = readDay(upTo(1), STOPS);
    expect(day.phase).toBe("at_shop");
    expect(day.action?.kind).toBe("left_shop");
    expect(day.headline).toContain("12 Elm St");
    expect(day.nextStop?.jobId).toBe("j1");
  });

  it("offers only the first stop after leaving the shop", () => {
    const day = readDay(upTo(2), STOPS);
    expect(day.phase).toBe("between_stops");
    expect(day.action).toEqual({ kind: "travelling", label: "On my way to Pat", jobId: "j1" });
  });

  it("tracks them on the way", () => {
    const day = readDay(upTo(3), STOPS);
    expect(day.phase).toBe("travelling");
    expect(day.action?.kind).toBe("arrived_job");
    expect(day.currentStop?.jobId).toBe("j1");
  });

  it("tracks them on site", () => {
    const day = readDay(upTo(4), STOPS);
    expect(day.phase).toBe("on_site");
    expect(day.action).toEqual({ kind: "finished_job", label: "Finished here", jobId: "j1" });
    expect(day.headline).toContain("12 Elm St");
  });

  it("moves to the second house once the first is finished", () => {
    const day = readDay(upTo(5), STOPS);
    expect(day.phase).toBe("between_stops");
    expect(day.nextStop?.jobId).toBe("j2");
    expect(day.action?.jobId).toBe("j2");
    expect(day.stopsDone).toEqual(["j1"]);
  });

  it("sends them back to the shop after the last stop", () => {
    const day = readDay(upTo(8), STOPS);
    expect(day.phase).toBe("stops_done");
    expect(day.action?.kind).toBe("returned_shop");
  });

  it("ends the day, with nothing left to press", () => {
    const day = readDay(upTo(9), STOPS);
    expect(day.phase).toBe("day_over");
    expect(day.action).toBeNull();
  });

  it("sends them straight back when they have no stops at all", () => {
    const day = readDay([ev("arrived_shop")], []);
    expect(day.phase).toBe("stops_done");
    expect(day.action?.kind).toBe("returned_shop");
  });

  it("re-points at a reordered day without losing finished work", () => {
    // The office swaps the order mid-morning after j1 is done. The first
    // outstanding stop is what matters, so the crew just gets sent to j2.
    const reordered = [STOPS[1], STOPS[0]];
    const day = readDay(upTo(5), reordered);
    expect(day.stopsDone).toEqual(["j1"]);
    expect(day.nextStop?.jobId).toBe("j2");
  });
});

describe("canRecord — the sequence is the point", () => {
  it("refuses to start the day anywhere but the shop", () => {
    const verdict = canRecord([], STOPS, "travelling", "j1");
    expect(verdict.ok).toBe(false);
    expect(verdict.ok === false && verdict.reason).toMatch(/at the shop first/i);
  });

  it("refuses to head for the second house before the first", () => {
    // The exact thing this exists to prevent.
    const verdict = canRecord(upTo(2), STOPS, "travelling", "j2");
    expect(verdict.ok).toBe(false);
    expect(verdict.ok === false && verdict.reason).toContain("12 Elm St");
  });

  it("refuses to arrive at a house they never set off for", () => {
    expect(canRecord(upTo(2), STOPS, "arrived_job", "j1").ok).toBe(false);
  });

  it("refuses to finish a stop they never arrived at", () => {
    const verdict = canRecord(upTo(3), STOPS, "finished_job", "j1");
    expect(verdict.ok).toBe(false);
    expect(verdict.ok === false && verdict.reason).toMatch(/arrived first/i);
  });

  it("refuses to finish the second house while standing at the first", () => {
    const verdict = canRecord(upTo(4), STOPS, "finished_job", "j2");
    expect(verdict.ok).toBe(false);
    expect(verdict.ok === false && verdict.reason).toMatch(/not the stop you're on/i);
  });

  it("refuses to leave the shop twice", () => {
    expect(canRecord(upTo(2), STOPS, "left_shop", null).ok).toBe(false);
  });

  it("refuses to go back to the shop with stops outstanding", () => {
    expect(canRecord(upTo(2), STOPS, "returned_shop", null).ok).toBe(false);
  });

  it("refuses anything once the day is over", () => {
    const verdict = canRecord(upTo(9), STOPS, "travelling", "j1");
    expect(verdict.ok).toBe(false);
    expect(verdict.ok === false && verdict.reason).toMatch(/already finished/i);
  });

  it("allows each correct step in turn", () => {
    const sequence: [number, CrewEventKind, string | null][] = [
      [0, "arrived_shop", null],
      [1, "left_shop", null],
      [2, "travelling", "j1"],
      [3, "arrived_job", "j1"],
      [4, "finished_job", "j1"],
      [5, "travelling", "j2"],
      [6, "arrived_job", "j2"],
      [7, "finished_job", "j2"],
      [8, "returned_shop", null],
    ];
    for (const [step, kind, jobId] of sequence) {
      expect(canRecord(upTo(step), STOPS, kind, jobId).ok, `step ${step} ${kind}`).toBe(true);
    }
  });
});

describe("minutesElapsed", () => {
  it("is nothing before the day starts", () => {
    expect(minutesElapsed([])).toBeNull();
  });

  it("measures a finished day end to end", () => {
    const events = upTo(9);
    expect(minutesElapsed(events)).toBe(8);
  });
});

describe("directionsUrl", () => {
  it("stays inside the app", () => {
    // Handing straight off to Google Maps is a one-way door: the crew leave,
    // and the tap that says "I'm on the way" is three apps back.
    expect(directionsUrl(STOPS[0])).toBe("/jobs/j1/directions");
  });

  it("works for a stop with no pin, since the screen handles that itself", () => {
    expect(directionsUrl({ ...STOPS[0], lat: null, lng: null })).toBe("/jobs/j1/directions");
  });
});
