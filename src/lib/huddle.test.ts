import { describe, expect, it } from "vitest";

import { crewName, crewsFromSchedule, defaultGoal, HUDDLE_MINUTES, huddleText, readCrews, stopCount } from "./huddle";

const VINCENT = "4d4818ff-0fc5-462f-86ae-d33624807ffb";

describe("team huddle", () => {
  it("is ten minutes", () => {
    expect(HUDDLE_MINUTES).toBe(10);
  });

  it("names crews after their lead", () => {
    expect(crewName("harrison smith")).toBe("Harrison's crew");
    expect(crewName("Max")).toBe("Max's crew");
    expect(crewName("Chris")).toBe("Chris' crew");
    expect(crewName("")).toBe("Unassigned");
  });

  it("counts a job two crews share once", () => {
    const crews = readCrews([
      { name: "Harrison's crew", stops: [{ client: "Priscilla Price" }, { jobId: VINCENT, client: "Vincent Hamlin" }] },
      { name: "Max's crew", meet: "Shop at 8 AM, follow Jordan's crew", stops: [] },
      { name: "Jordan's crew", stops: [{ job_id: VINCENT, client: "Vincent Hamlin" }] },
    ]);
    expect(stopCount(crews)).toBe(2);
    expect(defaultGoal(crews)).toMatch(/^3 crews, 2 stops\./);
  });

  it("reads a hand-written plan without trusting it", () => {
    const crews = readCrews([{ stops: [{ jobId: "../x", client: 5 }] }, null, "x"]);
    expect(crews).toEqual([{ name: "Crew", meet: "", stops: [{ jobId: null, client: "Client", address: "", time: "", work: "" }] }]);
    expect(readCrews({})).toEqual([]);
  });

  it("groups the schedule by lead, unassigned last", () => {
    const crews = crewsFromSchedule([
      { jobId: "b", client: "B", address: "", purpose: null, stopOrder: 2, lead: "Harrison" },
      { jobId: "c", client: "C", address: "", purpose: null, stopOrder: null, lead: null },
      { jobId: "a", client: "A", address: "", purpose: "Mow", stopOrder: 1, lead: "Harrison" },
    ]);
    expect(crews.map((c) => c.name)).toEqual(["Harrison's crew", "Unassigned"]);
    expect(crews[0].stops.map((s) => s.client)).toEqual(["A", "B"]);
  });

  it("copies as one team text with crew links", () => {
    const text = huddleText({
      day: "2026-11-21",
      goal: "Every job finished",
      crews: readCrews([{ name: "Jordan's crew", stops: [{ jobId: VINCENT, client: "Vincent Hamlin", work: "Wall" }] }]),
      watchOuts: "",
      blockers: "",
      shoutOut: "",
      source: "plan",
    });
    expect(text).toContain("1. The number: Every job finished");
    expect(text).toContain(`/crew/${VINCENT}`);
    expect(text).toContain("Then roll.");
    expect(text).not.toMatch(/buddy/i);
  });
});
