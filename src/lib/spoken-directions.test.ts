import { describe, expect, it } from "vitest";

import type { NavState } from "./navigation";
import { FRESH_MEMORY, departureLine, nextAnnouncement, routeSummary, speakableDistance } from "./spoken-directions";

function nav(over: Partial<NavState>): NavState {
  return {
    arrived: false,
    offRoute: false,
    stepIndex: 0,
    instruction: "Turn left onto Crafton Road",
    metresToTurn: 500,
    remainingMetres: 4000,
    remainingSeconds: 600,
    ...over,
  };
}

describe("speakableDistance", () => {
  it("says feet under a fifth of a mile and miles after", () => {
    expect(speakableDistance(12)).toBe("50 feet");
    expect(speakableDistance(150)).toBe("500 feet");
    expect(speakableDistance(1600)).toBe("1 mile");
    expect(speakableDistance(3500)).toBe("2.2 miles");
    expect(speakableDistance(20000)).toBe("12 miles");
  });
});

describe("nextAnnouncement", () => {
  it("announces a turn once far off and once close, and not in between", () => {
    const first = nextAnnouncement(FRESH_MEMORY, nav({}), "Toni");
    expect(first.say).toBe("In 1600 feet, turn left onto Crafton Road.".replace("1600 feet", speakableDistance(500)));
    const again = nextAnnouncement(first.memory, nav({ metresToTurn: 400 }), "Toni");
    expect(again.say).toBeNull();
    const close = nextAnnouncement(again.memory, nav({ metresToTurn: 90 }), "Toni");
    expect(close.say).toBe("Turn left onto Crafton Road.");
    const closer = nextAnnouncement(close.memory, nav({ metresToTurn: 20 }), "Toni");
    expect(closer.say).toBeNull();
  });

  it("moves on to the next step", () => {
    const m = { ...FRESH_MEMORY, farStep: 0, nearStep: 0 };
    const next = nextAnnouncement(m, nav({ stepIndex: 1, instruction: "Turn right onto Main Street", metresToTurn: 800 }), "Toni");
    expect(next.say).toMatch(/^In .* turn right onto Main Street\.$/);
  });

  it("says arrival once", () => {
    const a = nextAnnouncement(FRESH_MEMORY, nav({ arrived: true }), "Toni Brightwell");
    expect(a.say).toBe("You have arrived at Toni Brightwell.");
    expect(nextAnnouncement(a.memory, nav({ arrived: true }), "Toni Brightwell").say).toBeNull();
  });

  it("says off route on the way out and back on the way in, and stays quiet in between", () => {
    const off = nextAnnouncement(FRESH_MEMORY, nav({ offRoute: true }), "Toni");
    expect(off.say).toBe("You have come off the route.");
    expect(nextAnnouncement(off.memory, nav({ offRoute: true }), "Toni").say).toBeNull();
    const back = nextAnnouncement(off.memory, nav({ offRoute: false }), "Toni");
    expect(back.say).toBe("Back on the route.");
  });
});

describe("routeSummary and departureLine", () => {
  it("read as a person would say them", () => {
    expect(routeSummary({ customerName: "Toni", address: "1 Main St", metres: 3200, seconds: 540 })).toBe(
      "Heading to Toni, 1 Main St. 2 miles, about 9 minutes."
    );
    expect(departureLine({ customerName: "Toni", address: "1 Main St", purpose: "Junk removal" })).toBe(
      "On your way to Toni, 1 Main St. Junk removal."
    );
  });
});
