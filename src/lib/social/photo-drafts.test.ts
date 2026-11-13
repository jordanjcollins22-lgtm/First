import { describe, expect, it } from "vitest";

import { approvalSlot, choosePhotos, draftProblems, draftRow, draftText, partsToPlanText, safeNote, sourceLabel, suggestSlot } from "@/lib/social/photo-drafts";
import { DEFAULT_SOCIAL_CADENCE } from "@/lib/social/cadence";

const NOW = new Date("2026-11-13T15:00:00Z");
const BOOK = "https://app.example.com/book";
const p = (id: string, kind: "before" | "after", at: string, zone: string | null = "z1") => ({ id, kind, zone_id: zone, zone_name: null, created_at: at });

describe("draftText", () => {
  it("writes a caption that passes the posting checks, town only", () => {
    for (const shape of ["pair", "single", "upload"] as const) {
      const t = draftText({ shape, town: "Bel Air", service: "Mulching", bookingUrl: BOOK });
      expect(draftProblems(t)).toEqual([]);
      expect(t.hook).toContain("Bel Air");
      expect(t.cta).toContain(BOOK);
      expect(t.hashtags.length).toBeGreaterThanOrEqual(3);
    }
  });

  it("only says swipe for the before when there is one", () => {
    expect(draftText({ shape: "pair", town: "Bel Air", bookingUrl: BOOK }).body).toMatch(/Swipe for the before/);
    expect(draftText({ shape: "single", town: "Bel Air", bookingUrl: BOOK }).body).not.toMatch(/Swipe/);
  });

  it("scrubs the client's name and street", () => {
    const t = draftText({ shape: "upload", town: "Bel Air", note: "Done for Smithers on Oak Lane", bookingUrl: BOOK, privateTerms: ["Smithers", "Oak Lane"] });
    expect(JSON.stringify(t)).not.toMatch(/Smithers|Oak Lane/);
  });
});

describe("safeNote", () => {
  it("keeps a plain note and drops one with a price or a licence claim", () => {
    expect(safeNote("Beds edged and mulched.")).toBe("Beds edged and mulched.");
    expect(safeNote("Only $400 this week")).toBeNull();
    expect(safeNote("We are licensed and insured")).toBeNull();
    expect(safeNote("   ")).toBeNull();
  });
});

describe("choosePhotos", () => {
  it("prefers a before and after of the same area", () => {
    const c = choosePhotos([p("b", "before", "2026-11-10T10:00:00Z"), p("a", "after", "2026-11-10T12:00:00Z")]);
    expect(c).toMatchObject({ shape: "pair", before: { id: "b" }, after: { id: "a" } });
  });
  it("falls back to the latest after photo alone", () => {
    const c = choosePhotos([p("a1", "after", "2026-11-10T10:00:00Z", "z1"), p("a2", "after", "2026-11-10T12:00:00Z", "z2"), p("b", "before", "2026-11-10T09:00:00Z", "z3")]);
    expect(c).toMatchObject({ shape: "single", after: { id: "a2" } });
  });
  it("is nothing without an after", () => {
    expect(choosePhotos([p("b", "before", "2026-11-10T09:00:00Z")])).toBeNull();
  });
});

describe("slots", () => {
  it("suggests a cadence slot ahead of now, missing what is booked", () => {
    const first = suggestSlot(DEFAULT_SOCIAL_CADENCE, [], NOW)!;
    expect(first.getTime()).toBeGreaterThan(NOW.getTime());
    const second = suggestSlot(DEFAULT_SOCIAL_CADENCE, [{ at: first, platforms: ["facebook", "instagram"] }], NOW)!;
    expect(second.getTime()).not.toBe(first.getTime());
  });

  it("keeps the suggested time on approval while it is ahead and free, otherwise finds the next one", () => {
    const suggested = suggestSlot(DEFAULT_SOCIAL_CADENCE, [], NOW)!.toISOString();
    const base = { cadence: DEFAULT_SOCIAL_CADENCE, platforms: ["facebook", "instagram"], now: NOW };
    expect(approvalSlot({ ...base, suggested, booked: [] })?.toISOString()).toBe(suggested);
    const taken = approvalSlot({ ...base, suggested, booked: [{ at: suggested, platforms: ["facebook"] }] });
    expect(taken?.toISOString()).not.toBe(suggested);
    const past = approvalSlot({ ...base, suggested: "2026-11-01T14:00:00Z", booked: [] });
    expect(past!.getTime()).toBeGreaterThan(NOW.getTime());
  });
});

describe("draftRow", () => {
  it("is a draft, never approved", () => {
    const row = draftRow({
      organizationId: "o",
      text: draftText({ shape: "pair", town: "Bel Air", bookingUrl: BOOK }),
      slot: new Date("2026-11-17T15:00:00Z"),
      planDay: "2026-11-17",
      jobId: "j",
      beforePhotoId: "b",
      afterPhotoId: "a",
      source: "crew_photos",
      shape: "pair",
      now: NOW,
    });
    expect(row).toMatchObject({ status: "draft", approved_at: null, approved_by: null, card_style: "split", kind: "before-after", placement: "page" });
    expect(row).not.toHaveProperty("backlog_photo_id");
  });
});

describe("partsToPlanText", () => {
  it("moves the SEO line's hashtags into the hashtags", () => {
    const t = partsToPlanText({ hook: "New beds in Bel Air.", meat: "Edged and mulched.", cta: `Book: ${BOOK}`, seo: "Mulching in Bel Air, MD 21014. #Mulch #BelAir #HarfordCounty" });
    expect(t.hashtags).toEqual(["#Mulch", "#BelAir", "#HarfordCounty"]);
    expect(t.body).toContain("Mulching in Bel Air, MD 21014.");
  });
});

describe("sourceLabel", () => {
  it("names where a draft came from", () => {
    expect(sourceLabel({ backlogPhotoId: "x" })).toBe("Uploaded");
    expect(sourceLabel({ jobId: "j", jobNumber: 412, autoSource: "crew_photos" })).toBe("From job #412");
    expect(sourceLabel({ jobId: "j", seedKey: "s" })).toBe("Starter post");
    expect(sourceLabel({})).toBe("Planned");
  });
});
