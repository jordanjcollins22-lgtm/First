import { describe, expect, it } from "vitest";

import { crewMemberStatus, minutesOf, sortCrew } from "@/lib/lead-day";
import type { CrewEvent, Stop } from "@/lib/crew-day";

const stop: Stop = { jobId: "j1", sessionId: "s1", address: "1 Main St", customerName: "Smith", lat: null, lng: null, purpose: null };
const ev = (kind: CrewEvent["kind"], jobId: string | null = null): CrewEvent => ({ kind, jobId, at: "2026-10-13T11:00:00Z" });
// 7:30am and 6:30am in New York on 13 October 2026 (EDT, UTC-4).
const at730 = new Date("2026-10-13T11:30:00Z");
const at630 = new Date("2026-10-13T10:30:00Z");

describe("minutesOf", () => {
  it("reads HH:MM and HH:MM:SS", () => {
    expect(minutesOf("07:00")).toBe(420);
    expect(minutesOf("07:15:00")).toBe(435);
  });
  it("is null for nothing or nonsense", () => {
    expect(minutesOf(null)).toBeNull();
    expect(minutesOf("soon")).toBeNull();
    expect(minutesOf("25:00")).toBeNull();
  });
});

describe("crewMemberStatus", () => {
  it("is late past the start time with nothing from them", () => {
    expect(crewMemberStatus({ events: [], stops: [stop], arriveBy: "07:00", now: at730 })).toEqual({ tone: "late", label: "Late, due at 7:00 am" });
  });
  it("is not in yet before the start time", () => {
    expect(crewMemberStatus({ events: [], stops: [stop], arriveBy: "07:00", now: at630 }).tone).toBe("waiting");
  });
  it("is never late when no start time is set", () => {
    expect(crewMemberStatus({ events: [], stops: [stop], arriveBy: null, now: at730 })).toEqual({ tone: "waiting", label: "Not in yet" });
  });
  it("follows the day: shop, road, site, done", () => {
    const base = { stops: [stop], arriveBy: "07:00", now: at730 };
    expect(crewMemberStatus({ ...base, events: [ev("arrived_shop")] })).toEqual({ tone: "here", label: "At the shop" });
    expect(crewMemberStatus({ ...base, events: [ev("arrived_shop"), ev("left_shop"), ev("travelling", "j1")] }).label).toBe("On the way to Smith");
    expect(crewMemberStatus({ ...base, events: [ev("arrived_shop"), ev("left_shop"), ev("travelling", "j1"), ev("arrived_job", "j1")] }).label).toBe("On site at Smith");
    expect(crewMemberStatus({ ...base, events: [ev("arrived_shop"), ev("returned_shop")] }).tone).toBe("done");
  });
});

describe("sortCrew", () => {
  it("puts the late first and the finished last", () => {
    const people = [
      { name: "Ann", status: { tone: "done" as const, label: "" } },
      { name: "Bob", status: { tone: "here" as const, label: "" } },
      { name: "Cy", status: { tone: "late" as const, label: "" } },
    ];
    expect(sortCrew(people).map((p) => p.name)).toEqual(["Cy", "Bob", "Ann"]);
  });
});
