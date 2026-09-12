import { describe, expect, it } from "vitest";

import {
  canApprove,
  describeStatus,
  markIsUsable,
  marksOnPhoto,
  openMarks,
  readyForWalkthrough,
  reviewStatus,
  summarise,
  type PhotoMark,
} from "@/lib/photo-review";

function mark(over: Partial<PhotoMark> & { id: string }): PhotoMark {
  return {
    photoId: "p1",
    x: 0.5,
    y: 0.5,
    note: "Re-edge this corner",
    authorName: "Jordan",
    createdAt: "2026-08-27T10:00:00Z",
    resolvedAt: null,
    resolvedByName: null,
    ...over,
  };
}

describe("a mark the crew can act on", () => {
  it("needs something written on it", () => {
    // A pin with nothing on it sends somebody back to a garden to guess.
    expect(markIsUsable("Re-edge the bed")).toBe(true);
    expect(markIsUsable("")).toBe(false);
    expect(markIsUsable("   ")).toBe(false);
  });
});

describe("the punch list", () => {
  it("holds what is still outstanding, oldest first", () => {
    const list = openMarks([
      mark({ id: "b", createdAt: "2026-08-27T12:00:00Z" }),
      mark({ id: "a", createdAt: "2026-08-27T09:00:00Z" }),
      mark({ id: "done", resolvedAt: "2026-08-27T13:00:00Z" }),
    ]);
    expect(list.map((m) => m.id)).toEqual(["a", "b"]);
  });

  it("shows only a photo's own outstanding marks", () => {
    const marks = [mark({ id: "a" }), mark({ id: "b", photoId: "p2" })];
    expect(marksOnPhoto(marks, "p1").map((m) => m.id)).toEqual(["a"]);
  });

  it("says what is left in a line", () => {
    expect(summarise([])).toBe("Nothing outstanding");
    expect(summarise([mark({ id: "a" })])).toBe("1 touch-up");
    expect(summarise([mark({ id: "a" }), mark({ id: "b" })])).toBe("2 touch-ups");
    expect(summarise([mark({ id: "a", resolvedAt: "2026-08-27T13:00:00Z" })])).toBe(
      "Nothing outstanding"
    );
  });
});

describe("where the review has got to", () => {
  it("is not ready until the crew sign off", () => {
    expect(reviewStatus({ crewSignedOff: false, marks: [], approvedAt: null })).toBe("not_ready");
  });

  it("waits on the manager once they have", () => {
    expect(reviewStatus({ crewSignedOff: true, marks: [], approvedAt: null })).toBe(
      "awaiting_review"
    );
  });

  it("goes back to the crew while anything is outstanding", () => {
    expect(
      reviewStatus({ crewSignedOff: true, marks: [mark({ id: "a" })], approvedAt: null })
    ).toBe("changes_requested");
  });

  it("is approved once the list is clear and somebody said so", () => {
    expect(
      reviewStatus({
        crewSignedOff: true,
        marks: [mark({ id: "a", resolvedAt: "2026-08-27T12:00:00Z" })],
        approvedAt: "2026-08-27T13:00:00Z",
      })
    ).toBe("approved");
  });

  it("does not let an old approval cover a new mark", () => {
    // Approved on Tuesday, marked something on Wednesday: they have not
    // approved what they marked.
    expect(
      reviewStatus({
        crewSignedOff: true,
        marks: [mark({ id: "a", createdAt: "2026-08-28T09:00:00Z", resolvedAt: "2026-08-28T10:00:00Z" })],
        approvedAt: "2026-08-27T13:00:00Z",
      })
    ).toBe("awaiting_review");
  });

  it("lets the punch list beat an approval outright", () => {
    expect(
      reviewStatus({
        crewSignedOff: true,
        marks: [mark({ id: "a" })],
        approvedAt: "2026-08-29T13:00:00Z",
      })
    ).toBe("changes_requested");
  });
});

describe("signing off and getting the client out", () => {
  it("cannot approve with anything outstanding", () => {
    expect(canApprove([mark({ id: "a" })])).toBe(false);
    expect(canApprove([mark({ id: "a", resolvedAt: "2026-08-27T13:00:00Z" })])).toBe(true);
    expect(canApprove([])).toBe(true);
  });

  it("only books a walkthrough once the photos are approved", () => {
    // Booking one over work that still has a punch list is how a customer
    // gets shown the one bed nobody finished.
    expect(readyForWalkthrough("approved")).toBe(true);
    expect(readyForWalkthrough("changes_requested")).toBe(false);
    expect(readyForWalkthrough("awaiting_review")).toBe(false);
    expect(readyForWalkthrough("not_ready")).toBe(false);
  });

  it("says where things stand in a sentence", () => {
    expect(describeStatus("awaiting_review")).toContain("check the photos");
    expect(describeStatus("changes_requested")).toContain("punch list");
    expect(describeStatus("approved")).toContain("walkthrough");
  });
});
