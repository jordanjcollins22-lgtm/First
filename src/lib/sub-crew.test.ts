import { describe, expect, it } from "vitest";

import { areaState, canFinish, canTakePhoto, currentArea, nextStep, sayTime, subStage } from "./sub-crew";

const base = { usesOurTools: false, pickedUpAt: null, onWayAt: null, arrivedAt: null, finishedAt: null };

describe("a subcontractor's day on their crew sheet", () => {
  it("goes straight to the job with their own tools", () => {
    expect(subStage(base)).toBe("go");
    expect(nextStep(base)).toBe("on_way");
    expect(nextStep({ ...base, onWayAt: "t" })).toBe("arrived");
    expect(subStage({ ...base, onWayAt: "t", arrivedAt: "t" })).toBe("on_site");
    expect(nextStep({ ...base, arrivedAt: "t" })).toBeNull();
  });

  it("picks up at the shop first when they use our tools", () => {
    const ours = { ...base, usesOurTools: true };
    expect(subStage(ours)).toBe("pickup");
    expect(nextStep(ours)).toBe("picked_up");
    expect(subStage({ ...ours, pickedUpAt: "t" })).toBe("go");
  });

  it("is finished once they say so", () => {
    expect(subStage({ ...base, arrivedAt: "t", finishedAt: "t" })).toBe("finished");
  });
});

describe("the areas", () => {
  it("are done by the after photo, prepped by the during photo", () => {
    expect(areaState([])).toBe("todo");
    expect(areaState(["before", "during"])).toBe("prepped");
    expect(areaState(["during", "after"])).toBe("done");
  });

  it("must all have the after photo before they can finish", () => {
    expect(canFinish(["done", "done"])).toEqual({ ok: true });
    expect(canFinish(["done", "prepped"])).toEqual({ ok: false, reason: "1 area still needs the after photo." });
    expect(canFinish(["todo", "todo"])).toEqual({ ok: false, reason: "2 areas still need the after photo." });
  });

  it("says the shop time the way people say it", () => {
    expect(sayTime("07:00:00")).toBe("7:00 am");
    expect(sayTime("13:30")).toBe("1:30 pm");
    expect(sayTime("00:15")).toBe("12:15 am");
    expect(sayTime(null)).toBeNull();
  });
});

describe("prep every area first", () => {
  const zones = [{ id: "a" }, { id: "b" }];

  it("preps the areas in order, then does the work in order", () => {
    expect(currentArea(zones, { a: "todo", b: "todo" })).toEqual({ zone: { id: "a" }, kind: "during" });
    expect(currentArea(zones, { a: "prepped", b: "todo" })).toEqual({ zone: { id: "b" }, kind: "during" });
    expect(currentArea(zones, { a: "prepped", b: "prepped" })).toEqual({ zone: { id: "a" }, kind: "after" });
    expect(currentArea(zones, { a: "done", b: "prepped" })).toEqual({ zone: { id: "b" }, kind: "after" });
    expect(currentArea(zones, { a: "done", b: "done" })).toBeNull();
  });

  it("holds the after photo until every area is prepped", () => {
    expect(canTakePhoto("after", "prepped", false)).toEqual({ ok: false, reason: "Every area gets prepped first. Prep the next area." });
    expect(canTakePhoto("after", "prepped", true).ok).toBe(true);
    expect(canTakePhoto("during", "prepped", false).ok).toBe(false);
  });
});
