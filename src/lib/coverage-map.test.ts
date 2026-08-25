import { describe, expect, it } from "vitest";

import {
  STATE_ORDER,
  contactState,
  describeCoverage,
  summariseCoverage,
  type ContactState,
  type ProspectContactInput,
} from "@/lib/coverage-map";

function prospect(o: Partial<ProspectContactInput> = {}): ProspectContactInput {
  return { status: "new", doNotContact: false, lastOutcome: null, ...o };
}

describe("contactState", () => {
  it("starts every property grey", () => {
    expect(contactState(prospect())).toBe("uncontacted");
  });

  it("lets do-not-contact beat every cheerier state", () => {
    // The one state that must never be overwritten by something later and
    // more optimistic.
    expect(contactState(prospect({ doNotContact: true, lastOutcome: "booked" }))).toBe("closed");
    expect(contactState(prospect({ doNotContact: true, status: "converted" }))).toBe("closed");
  });

  it("marks a property that gave us a name, even though they said no", () => {
    // The whole argument for working the rest of the county.
    expect(contactState(prospect({ lastOutcome: "referral_received" }))).toBe("referral");
    expect(contactState(prospect({ lastOutcome: "not_interested", everReferred: true }))).toBe("referral");
  });

  it("separates a no-answer from a conversation", () => {
    // The difference decides whether to knock again.
    expect(contactState(prospect({ lastOutcome: "attempted" }))).toBe("attempted");
    expect(contactState(prospect({ lastOutcome: "reached" }))).toBe("spoken_to");
    expect(contactState(prospect({ lastOutcome: "not_interested" }))).toBe("spoken_to");
  });

  it("treats a booking as the strongest kind of interest", () => {
    expect(contactState(prospect({ lastOutcome: "booked" }))).toBe("interested");
    expect(contactState(prospect({ lastOutcome: "interested" }))).toBe("interested");
  });

  it("shows somebody who became a client as ours", () => {
    expect(contactState(prospect({ status: "converted" }))).toBe("client");
  });

  it("trusts an imported status when nobody has logged a touch", () => {
    // A list imported as already-contacted must not be drawn as virgin
    // territory.
    expect(contactState(prospect({ status: "contacted" }))).toBe("attempted");
    expect(contactState(prospect({ status: "rejected" }))).toBe("closed");
  });

  it("prefers a logged outcome over the imported status", () => {
    expect(contactState(prospect({ status: "contacted", lastOutcome: "reached" }))).toBe("spoken_to");
  });
});

describe("summariseCoverage", () => {
  const states: ContactState[] = [
    "uncontacted",
    "uncontacted",
    "uncontacted",
    "attempted",
    "referral",
    "client",
  ];

  it("measures the thing the exercise is measured by", () => {
    const summary = summariseCoverage(states);
    expect(summary.total).toBe(6);
    expect(summary.touched).toBe(3);
    expect(summary.fraction).toBeCloseTo(0.5);
  });

  it("counts the names gathered from people who were never going to buy", () => {
    expect(summariseCoverage(states).referrals).toBe(1);
  });

  it("keeps every colour in the legend, including the empty ones", () => {
    // A colour that vanishes when nobody is in it makes the map unreadable
    // the first time somebody does land in it.
    const summary = summariseCoverage(["uncontacted"]);
    expect(summary.tallies).toHaveLength(STATE_ORDER.length);
    expect(summary.tallies.find((t) => t.state === "client")?.count).toBe(0);
  });

  it("copes with nothing imported", () => {
    expect(summariseCoverage([])).toMatchObject({ total: 0, touched: 0, fraction: 0 });
  });
});

describe("describeCoverage", () => {
  it("says how many doors are left, not just a percentage", () => {
    // A number somebody can divide by thirty calls a day.
    const text = describeCoverage(summariseCoverage(["uncontacted", "uncontacted", "attempted", "client"]));
    expect(text).toContain("50%");
    expect(text).toContain("2 properties");
  });

  it("sends somebody to import when there is nothing on the map", () => {
    expect(describeCoverage(summariseCoverage([]))).toContain("Import the county");
  });

  it("says so plainly once the county is done", () => {
    expect(describeCoverage(summariseCoverage(["client", "attempted"]))).toContain("at least once");
  });
});
