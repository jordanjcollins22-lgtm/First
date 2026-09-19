import { describe, expect, it } from "vitest";

import {
  FALLBACK_TIME_ZONE,
  respondedMoment,
  responseLabel,
  responseShort,
} from "@/lib/proposal-accepted";

/** A Tuesday evening in September, nine fourteen in New York. */
const EVENING = "2026-09-09T01:14:00.000Z";
const ZONE = "America/New_York";

describe("when a client answered", () => {
  it("gives the day and the time apart, so a screen can lay them out", () => {
    const moment = respondedMoment(EVENING, ZONE)!;
    expect(moment.day).toBe("Tue, Sep 8, 2026");
    expect(moment.time).toBe("9:14 PM");
  });

  it("uses the business's clock, not the machine's", () => {
    // The server runs on UTC. Read there, this evening acceptance becomes one
    // in the morning the next day — the wrong time on the wrong date, on the
    // record that says when the deposit came due.
    const business = respondedMoment(EVENING, ZONE)!;
    const utc = respondedMoment(EVENING, "UTC")!;
    expect(utc.day).toBe("Wed, Sep 9, 2026");
    expect(business.day).not.toBe(utc.day);
  });

  it("says which clock it is, so nobody has to guess", () => {
    expect(respondedMoment(EVENING, ZONE)!.zone).toBe("EDT");
    expect(respondedMoment("2026-01-15T14:00:00.000Z", ZONE)!.zone).toBe("EST");
  });

  it("hands back the raw timestamp for the markup", () => {
    expect(respondedMoment(EVENING, ZONE)!.iso).toBe(EVENING);
  });

  it("is nothing when they have not answered", () => {
    expect(respondedMoment(null, ZONE)).toBeNull();
    expect(respondedMoment(undefined, ZONE)).toBeNull();
    expect(respondedMoment("", ZONE)).toBeNull();
  });

  it("is nothing rather than 'Invalid Date' when the timestamp is rubbish", () => {
    expect(respondedMoment("not a date", ZONE)).toBeNull();
  });

  it("falls back to the office's zone when none is set", () => {
    expect(respondedMoment(EVENING, null)).toEqual(respondedMoment(EVENING, FALLBACK_TIME_ZONE));
    expect(respondedMoment(EVENING, "   ")).toEqual(respondedMoment(EVENING, FALLBACK_TIME_ZONE));
  });

  it("survives a typo in the organization's timezone", () => {
    // Intl throws on an unknown zone rather than falling back, so a typo in
    // one settings field would otherwise take out every screen showing a date.
    expect(respondedMoment(EVENING, "Amercia/New_Yrok")).toEqual(
      respondedMoment(EVENING, FALLBACK_TIME_ZONE)
    );
  });
});

describe("the whole sentence", () => {
  it("says accepted when they accepted", () => {
    expect(responseLabel("accepted", EVENING, ZONE)).toBe("Accepted Tue, Sep 8, 2026 at 9:14 PM EDT");
  });

  it("never calls a decline an acceptance", () => {
    expect(responseLabel("declined", EVENING, ZONE)).toContain("Declined");
    expect(responseLabel("declined", EVENING, ZONE)).not.toContain("Accepted");
  });

  it("stays neutral about a status it does not know", () => {
    expect(responseLabel("sent", EVENING, ZONE)).toContain("Answered");
    expect(responseLabel(null, EVENING, ZONE)).toContain("Answered");
  });

  it("is nothing when there is no answer to describe", () => {
    expect(responseLabel("accepted", null, ZONE)).toBeNull();
  });
});

describe("the short form, for a tight space", () => {
  it("drops the weekday and the year but keeps the time", () => {
    expect(responseShort(EVENING, ZONE)).toBe("Sep 8, 9:14 PM");
  });

  it("is nothing when they have not answered", () => {
    expect(responseShort(null, ZONE)).toBeNull();
  });
});
