import { describe, expect, it } from "vitest";

import { directionsUrl, MAX_WAYPOINTS, progressOf, type Stop } from "./route-walk";

const stop = (n: number): Stop => ({ id: `s${n}`, address: `${n} Brooks Rd`, lat: 39.5 + n / 1000, lng: -76.35 });
const round = (n: number) => Array.from({ length: n }, (_, i) => stop(i + 1));

describe("where somebody is up to", () => {
  it("starts at the first door", () => {
    const p = progressOf(round(5), 0);
    expect(p.next?.address).toBe("1 Brooks Rd");
    expect(p.done).toBe(0);
    expect(p.percent).toBe(0);
  });

  it("moves on one door at a time", () => {
    expect(progressOf(round(5), 2).next?.address).toBe("3 Brooks Rd");
  });

  it("knows when the round is finished", () => {
    const p = progressOf(round(3), 3);
    expect(p.finished).toBe(true);
    expect(p.next).toBeNull();
    expect(p.percent).toBe(100);
  });

  it("cannot be pushed past the end or before the start", () => {
    // The count comes from a browser; it does not get to invent doors.
    expect(progressOf(round(3), 99).done).toBe(3);
    expect(progressOf(round(3), -4).done).toBe(0);
  });

  it("has nothing to say about an empty round", () => {
    const p = progressOf([], 0);
    expect(p.finished).toBe(false);
    expect(p.next).toBeNull();
    expect(p.percent).toBe(0);
  });
});

describe("the maps link", () => {
  it("is null when there is nowhere to go", () => {
    expect(directionsUrl([])).toBeNull();
  });

  it("sends one door as a destination", () => {
    const url = directionsUrl([stop(1)])!;
    expect(url).toContain("destination=39.501%2C-76.35");
    expect(url).not.toContain("waypoints");
  });

  it("strings a run of doors together, so it is a street rather than a house", () => {
    const url = directionsUrl(round(4))!;
    expect(url).toContain("waypoints=");
    // The last is the destination; the rest are waypoints.
    expect(url).toContain("destination=39.504%2C-76.35");
  });

  it("caps the run at what a maps link will actually accept", () => {
    // Past this the URL is refused outright, which reads as a broken button.
    const url = directionsUrl(round(30))!;
    expect(url.split("%7C").length).toBe(MAX_WAYPOINTS - 1);
  });

  it("starts from where the person is when that is known", () => {
    expect(directionsUrl(round(2), { lat: 39.4, lng: -76.3 })!).toContain("origin=39.4%2C-76.3");
  });
});
