import { describe, expect, it } from "vitest";
import {
  ARRIVAL_METRES,
  arrivalClock,
  currentStepIndex,
  hasArrived,
  isOffRoute,
  metresBetween,
  metresToStep,
  navigate,
  remainingMetres,
  remainingSeconds,
  snapToRoute,
  spokenDistance,
  spokenDuration,
} from "./navigation";

// A straight run east along one latitude, roughly 80 m between points, which
// is the shape of a road out of Bel Air.
const A: [number, number] = [-76.3483, 39.5359];
const B: [number, number] = [-76.3474, 39.5359];
const C: [number, number] = [-76.3465, 39.5359];
const D: [number, number] = [-76.3456, 39.5359];
const LINE: [number, number][] = [A, B, C, D];

const at = ([lng, lat]: [number, number]) => ({ lng, lat });

describe("metresBetween", () => {
  it("measures a short hop the way a tape measure would", () => {
    const metres = metresBetween(at(A), at(B));
    expect(metres).toBeGreaterThan(70);
    expect(metres).toBeLessThan(85);
  });

  it("is zero for a point and itself", () => {
    expect(metresBetween(at(A), at(A))).toBe(0);
  });

  it("does not care which way round it is asked", () => {
    expect(metresBetween(at(A), at(D))).toBeCloseTo(metresBetween(at(D), at(A)), 6);
  });
});

describe("snapToRoute", () => {
  it("finds the point on the line the driver is nearest", () => {
    expect(snapToRoute(at(C), LINE)?.index).toBe(2);
  });

  it("reports how far off the line they are", () => {
    // A hundred metres north of the road.
    const off = snapToRoute({ lng: -76.3465, lat: 39.5368 }, LINE);
    expect(off!.offRouteMetres).toBeGreaterThan(80);
  });

  it("has nothing to say about a route with no line", () => {
    expect(snapToRoute(at(A), [])).toBeNull();
  });
});

describe("remainingMetres", () => {
  it("counts what is left from where the driver actually is", () => {
    const snap = snapToRoute(at(B), LINE)!;
    const left = remainingMetres(at(B), LINE, snap);
    // Two hops of about 80 m still to go.
    expect(left).toBeGreaterThan(140);
    expect(left).toBeLessThan(180);
  });

  it("includes the hop onto the line", () => {
    // Somebody a street away is not zero metres from the end just because the
    // nearest vertex happens to be the last one.
    const away = { lng: -76.3456, lat: 39.5375 };
    const snap = snapToRoute(away, LINE)!;
    expect(remainingMetres(away, LINE, snap)).toBeGreaterThan(100);
  });

  it("is near enough nothing at the end of the line", () => {
    const snap = snapToRoute(at(D), LINE)!;
    expect(remainingMetres(at(D), LINE, snap)).toBeLessThan(1);
  });
});

describe("currentStepIndex", () => {
  const steps = [
    { instruction: "Head east", location: A },
    { instruction: "Turn left onto Crafton Road", location: C },
    { instruction: "You have arrived", location: D },
  ];

  it("announces the next turn, not the one just passed", () => {
    const snap = snapToRoute(at(B), LINE)!;
    expect(currentStepIndex(steps, LINE, snap)).toBe(1);
  });

  it("moves on once the turn is behind them", () => {
    const snap = snapToRoute(at(C), LINE)!;
    expect(currentStepIndex(steps, LINE, snap)).toBe(2);
  });

  it("holds on the last instruction at the end", () => {
    const snap = snapToRoute(at(D), LINE)!;
    expect(currentStepIndex(steps, LINE, snap)).toBe(2);
  });

  it("measures along the route, not as the crow flies", () => {
    // A route that doubles back passes close to a later turn while an earlier
    // one is still to come. Nearest-turn would jump the instructions about.
    const outAndBack: [number, number][] = [A, B, C, B, A];
    const doubling = [
      { instruction: "Head east", location: A },
      { instruction: "Turn round", location: C },
      { instruction: "Arrive back", location: A },
    ];
    const snap = snapToRoute(at(B), outAndBack)!;
    expect(currentStepIndex(doubling, outAndBack, snap)).toBe(1);
  });

  it("has an answer for a route with no steps", () => {
    expect(currentStepIndex([], LINE, { index: 0, offRouteMetres: 0 })).toBe(-1);
  });
});

describe("metresToStep", () => {
  it("measures to where the turn happens", () => {
    expect(metresToStep(at(A), { instruction: "x", location: C })).toBeGreaterThan(140);
  });

  it("says nothing rather than zero for a step with no location", () => {
    // Zero would announce "turn now" at a turn nobody can place.
    expect(metresToStep(at(A), { instruction: "x", location: null })).toBeNull();
    expect(metresToStep(at(A), undefined)).toBeNull();
  });
});

describe("remainingSeconds", () => {
  const route = { distance: 1000, duration: 120 };

  it("scales the route's own estimate by what is left", () => {
    expect(remainingSeconds(route, 500)).toBe(60);
  });

  it("never reports more time than the whole journey", () => {
    expect(remainingSeconds(route, 5000)).toBe(120);
  });

  it("never reports a negative", () => {
    expect(remainingSeconds(route, -10)).toBe(0);
  });

  it("has an answer for a route of no length", () => {
    expect(remainingSeconds({ distance: 0, duration: 60 }, 0)).toBe(0);
  });
});

describe("hasArrived", () => {
  it("is generous, because a phone in a cab is not precise", () => {
    // Parked on the drive being told you have not arrived is worse than the
    // other way round.
    const nearly = { lng: -76.3456, lat: 39.53594 };
    expect(metresBetween(nearly, at(D))).toBeLessThan(ARRIVAL_METRES);
    expect(hasArrived(nearly, at(D))).toBe(true);
  });

  it("is not true from the next street", () => {
    expect(hasArrived({ lng: -76.3456, lat: 39.5375 }, at(D))).toBe(false);
  });
});

describe("isOffRoute", () => {
  it("ignores the wobble of a phone sitting at a junction", () => {
    expect(isOffRoute({ index: 1, offRouteMetres: 20 })).toBe(false);
  });

  it("notices a genuinely different road", () => {
    expect(isOffRoute({ index: 1, offRouteMetres: 400 })).toBe(true);
  });

  it("does not claim off-route when there is no route", () => {
    expect(isOffRoute(null)).toBe(false);
  });
});

describe("spokenDistance", () => {
  it("says feet close in, rounded to something sayable", () => {
    // Nobody needs "487 feet".
    expect(spokenDistance(150)).toBe("500 ft");
    expect(spokenDistance(30)).toBe("100 ft");
  });

  it("says miles further out", () => {
    expect(spokenDistance(3000)).toBe("1.9 mi");
    expect(spokenDistance(30000)).toBe("19 mi");
  });

  it("says now when it is now", () => {
    expect(spokenDistance(5)).toBe("Now");
  });

  it("says nothing rather than a number it does not have", () => {
    expect(spokenDistance(null)).toBe("");
    expect(spokenDistance(Number.NaN)).toBe("");
  });
});

describe("spokenDuration", () => {
  it("reads like a person saying it", () => {
    expect(spokenDuration(300)).toBe("5 min");
    expect(spokenDuration(3600)).toBe("1 hr");
    expect(spokenDuration(5400)).toBe("1 hr 30 min");
    expect(spokenDuration(20)).toBe("under a minute");
  });

  it("has an answer for nothing left", () => {
    expect(spokenDuration(0)).toBe("0 min");
  });
});

describe("arrivalClock", () => {
  it("says when they get there, for telling a client", () => {
    const now = new Date("2026-06-15T14:00:00Z");
    expect(arrivalClock(1800, now)).toBe(
      new Date("2026-06-15T14:30:00Z").toLocaleTimeString(undefined, {
        hour: "numeric",
        minute: "2-digit",
      })
    );
  });
});

describe("navigate", () => {
  const route = {
    distance: 240,
    duration: 60,
    coordinates: LINE,
    steps: [
      { instruction: "Head east", location: A },
      { instruction: "Turn left onto Crafton Road", location: C },
      { instruction: "You have arrived", location: D },
    ],
  };

  it("answers everything the screen needs from one fix", () => {
    const state = navigate({ position: at(B), destination: at(D), route });
    expect(state.arrived).toBe(false);
    expect(state.instruction).toMatch(/Crafton/);
    expect(state.metresToTurn).toBeGreaterThan(0);
    expect(state.remainingMetres).toBeGreaterThan(0);
    expect(state.remainingSeconds).toBeGreaterThan(0);
  });

  it("says arrived and stops counting, all at once", () => {
    // The parts must not disagree: "turn left in 200 feet, arriving now" is
    // what happens when the ETA and the turn come from different reads.
    const state = navigate({ position: at(D), destination: at(D), route });
    expect(state.arrived).toBe(true);
    expect(state.remainingMetres).toBe(0);
    expect(state.remainingSeconds).toBe(0);
    expect(state.metresToTurn).toBe(0);
    expect(state.instruction).toMatch(/arrived/i);
  });

  it("flags a driver who has left the route", () => {
    const state = navigate({
      position: { lng: -76.36, lat: 39.545 },
      destination: at(D),
      route,
    });
    expect(state.offRoute).toBe(true);
    expect(state.arrived).toBe(false);
  });

  it("survives a route with no line to snap to", () => {
    const state = navigate({
      position: at(A),
      destination: at(D),
      route: { ...route, coordinates: [] },
    });
    expect(state.remainingMetres).toBe(route.distance);
    expect(state.offRoute).toBe(false);
  });
});
