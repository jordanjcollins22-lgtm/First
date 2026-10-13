import { describe, expect, it } from "vitest";

import { lowRatingKey, reviewDedupeKey, reviewMessage, reviewSkipReason, reviewStepDue, routeRating } from "@/lib/client-automations/reviews";

const now = new Date("2026-10-13T15:00:00Z");

describe("reviewSkipReason", () => {
  it("asks somebody never asked", () => {
    expect(reviewSkipReason({ hasRecordedReview: false, earlier: [] }, now, 12)).toBeNull();
  });
  it("skips anybody who already reviewed", () => {
    expect(reviewSkipReason({ hasRecordedReview: true, earlier: [] }, now, 12)).toBe("already_reviewed");
    expect(reviewSkipReason({ hasRecordedReview: false, earlier: [{ createdAt: new Date("2024-01-01"), sentToGoogleAt: new Date("2024-01-02") }] }, now, 12)).toBe("already_reviewed");
  });
  it("skips anybody asked in the last twelve months, not before", () => {
    expect(reviewSkipReason({ hasRecordedReview: false, earlier: [{ createdAt: new Date("2026-03-01"), sentToGoogleAt: null }] }, now, 12)).toBe("asked_recently");
    expect(reviewSkipReason({ hasRecordedReview: false, earlier: [{ createdAt: new Date("2025-09-01"), sentToGoogleAt: null }] }, now, 12)).toBeNull();
  });
});

describe("reviewStepDue", () => {
  const triggeredAt = new Date("2026-10-10T15:00:00Z");
  const at = (iso: string, ratedAt: Date | null = null) => reviewStepDue({ triggeredAt, ratedAt, now: new Date(iso), reminderDays: 3 });
  it("asks straight away, and for long enough to get past the night", () => {
    expect(at("2026-10-10T15:20:00Z")).toBe("ask");
    expect(at("2026-10-11T13:00:00Z")).toBe("ask");
    expect(at("2026-10-12T16:00:00Z")).toBeNull();
  });
  it("reminds once on day 3, and not after a rating", () => {
    expect(at("2026-10-13T16:00:00Z")).toBe("reminder");
    expect(at("2026-10-14T16:00:00Z")).toBeNull();
    expect(at("2026-10-13T16:00:00Z", new Date("2026-10-11T00:00:00Z"))).toBeNull();
  });
});

describe("routeRating", () => {
  it("sends fives to Google and the rest to the owner", () => {
    expect(routeRating(5, "https://g.page/r/x/review")).toBe("google");
    expect(routeRating(4, "https://g.page/r/x/review")).toBe("owner");
    expect(routeRating(1, "")).toBe("owner");
    expect(routeRating(5, "")).toBe("thanks");
    expect(routeRating(7, "https://g")).toBe("thanks");
  });
});

describe("keys and words", () => {
  it("is one ask and one reminder per request", () => {
    expect(reviewDedupeKey("r1", "ask", "sms")).toBe("review_request:r1:ask:sms");
    expect(lowRatingKey("r1")).toBe("low_rating:r1");
  });
  it("carries the rating link", () => {
    const msg = reviewMessage({ step: "ask", channel: "sms", businessName: "JS", clientName: "Ann Lee", link: "https://x/rate/t" });
    expect(msg.body).toBe("JS: Hi Ann, thank you for having us. How did we do? One tap, 1 to 5: https://x/rate/t");
  });
});
