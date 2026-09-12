import { describe, expect, it } from "vitest";

import {
  arrivalTime,
  externalNavUrl,
  formatDistance,
  formatDuration,
  parseRoute,
  routeBounds,
} from "@/lib/directions";

describe("formatDistance", () => {
  it("uses feet below a tenth of a mile", () => {
    // "0.04 miles" is not a thing anybody says or can judge out of a
    // windscreen.
    expect(formatDistance(60)).toBe("200 ft");
  });

  it("uses one decimal for ordinary driving distances", () => {
    expect(formatDistance(3218)).toBe("2.0 mi");
  });

  it("drops the decimal once it stops mattering", () => {
    expect(formatDistance(40000)).toBe("25 mi");
  });

  it("never rounds a real distance down to nothing", () => {
    expect(formatDistance(1)).toBe("1 ft");
  });
});

describe("formatDuration", () => {
  it("answers in minutes for a normal drive", () => {
    expect(formatDuration(900)).toBe("15 min");
  });

  it("switches to hours and minutes past the hour", () => {
    expect(formatDuration(5400)).toBe("1 hr 30 min");
    expect(formatDuration(7200)).toBe("2 hr");
  });

  it("says something rather than 0 min for a very short hop", () => {
    expect(formatDuration(20)).toBe("less than a minute");
  });
});

describe("arrivalTime", () => {
  it("answers the question a client actually rang to ask", () => {
    const at = arrivalTime(1800, new Date(2026, 7, 19, 9, 0));
    expect(at).toMatch(/9:30/);
  });
});

describe("parseRoute", () => {
  const body = {
    routes: [
      {
        distance: 4800,
        duration: 600,
        geometry: { coordinates: [[-76.3, 39.5], [-76.31, 39.51]] as [number, number][] },
        legs: [
          {
            steps: [
              { maneuver: { instruction: "Head north on Elm St" }, distance: 200, name: "Elm St" },
              { maneuver: { instruction: "Turn left onto Crafton Rd" }, distance: 4600, name: "Crafton Rd" },
            ],
          },
        ],
      },
    ],
  };

  it("takes the first route and its turns", () => {
    const route = parseRoute(body)!;
    expect(route.distance).toBe(4800);
    expect(route.steps.map((s) => s.instruction)).toEqual([
      "Head north on Elm St",
      "Turn left onto Crafton Rd",
    ]);
  });

  it("drops a step with no words rather than printing a blank row", () => {
    // A blank row makes the list look broken rather than short.
    const withBlank = {
      routes: [{ ...body.routes[0], legs: [{ steps: [{ maneuver: { instruction: "  " }, distance: 5 }] }] }],
    };
    expect(parseRoute(withBlank)!.steps).toEqual([]);
  });

  it("refuses a response with no usable line rather than half a route", () => {
    // A panel showing a distance and no line is worse than one saying it
    // could not work out the way, because the first looks like it worked.
    expect(parseRoute({ routes: [{ distance: 100, geometry: { coordinates: [] } }] })).toBeNull();
    expect(parseRoute({ routes: [] })).toBeNull();
    expect(parseRoute({})).toBeNull();
  });

  it("joins the steps across every leg", () => {
    const twoLegs = {
      routes: [
        {
          ...body.routes[0],
          legs: [
            { steps: [{ maneuver: { instruction: "One" }, distance: 1 }] },
            { steps: [{ maneuver: { instruction: "Two" }, distance: 2 }] },
          ],
        },
      ],
    };
    expect(parseRoute(twoLegs)!.steps.map((s) => s.instruction)).toEqual(["One", "Two"]);
  });
});

describe("routeBounds", () => {
  it("frames every point on the line", () => {
    const bounds = routeBounds([
      [-76.3, 39.5],
      [-76.1, 39.7],
      [-76.5, 39.4],
    ]);
    expect(bounds).toEqual([
      [-76.5, 39.4],
      [-76.1, 39.7],
    ]);
  });

  it("has nothing to frame when there is no line", () => {
    expect(routeBounds([])).toBeNull();
  });
});

describe("externalNavUrl", () => {
  it("hands over coordinates when we have them", () => {
    // An address string is re-geocoded by the other app and can land on the
    // wrong Elm Street.
    const url = externalNavUrl({ lat: 39.5, lng: -76.3, address: "12 Elm St" });
    expect(url).toContain("destination=39.5,-76.3");
  });

  it("falls back to the address rather than nothing", () => {
    const url = externalNavUrl({ lat: null, lng: null, address: "12 Elm St" });
    expect(url).toContain(encodeURIComponent("12 Elm St"));
  });
});
