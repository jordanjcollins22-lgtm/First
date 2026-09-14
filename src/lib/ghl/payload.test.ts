import { describe, expect, it } from "vitest";

import { appointmentTitle, appointmentWindow, splitName } from "./payload";

describe("GoHighLevel appointment", () => {
  it("is titled by kind, client and street", () => {
    expect(appointmentTitle({ customerName: "Kelsey Weissner", address: "2000 Highland Avenue, Bel Air, Maryland 21015", mode: "in_person" })).toBe(
      "Evaluation: Kelsey Weissner at 2000 Highland Avenue"
    );
    expect(appointmentTitle({ customerName: "Elise", address: "7710 Princess Place, Pasadena", mode: "digital" })).toBe(
      "Video walkthrough: Elise at 7710 Princess Place"
    );
  });

  it("runs an hour when no end was booked", () => {
    const w = appointmentWindow({ startsAt: "2026-09-16T13:00:00.000Z", endsAt: null });
    expect(w).toEqual({ startTime: "2026-09-16T13:00:00.000Z", endTime: "2026-09-16T14:00:00.000Z" });
    expect(appointmentWindow({ startsAt: "2026-09-16T13:00:00Z", endsAt: "2026-09-16T13:30:00Z" }).endTime).toBe(
      "2026-09-16T13:30:00.000Z"
    );
  });

  it("splits a name the way the contact record wants it", () => {
    expect(splitName("Toni Brightwell")).toEqual({ firstName: "Toni", lastName: "Brightwell" });
    expect(splitName("Cher")).toEqual({ firstName: "Cher", lastName: "" });
    expect(splitName("  ")).toEqual({ firstName: "Client", lastName: "" });
  });
});
