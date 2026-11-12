import { describe, expect, it } from "vitest";

import { planProblems } from "@/lib/social-plan";
import { localWeekKey } from "@/lib/marketing/social-autopost";
import { DEFAULT_SOCIAL_CADENCE } from "./cadence";
import { SEED_DRAFTS, SEED_TOPIC_LABEL, seedCta, seedSlot } from "./seed-drafts";

describe("starter drafts", () => {
  it("are twelve, each with its own key", () => {
    expect(SEED_DRAFTS).toHaveLength(12);
    expect(new Set(SEED_DRAFTS.map((d) => d.key)).size).toBe(12);
  });

  it("pass the plan's rules", () => {
    for (const d of SEED_DRAFTS) expect(planProblems(d), d.key).toEqual([]);
  });

  it("cover every topic asked for", () => {
    expect(new Set(SEED_DRAFTS.map((d) => d.topic))).toEqual(new Set(Object.keys(SEED_TOPIC_LABEL)));
  });

  it("run four a week for three weeks, on the default best times", () => {
    const top = DEFAULT_SOCIAL_CADENCE.slots.slice(0, 4).map((s) => `${s.weekday}:${s.hour}`);
    const weeks = new Map<string, number>();
    for (const d of SEED_DRAFTS) {
      const weekday = new Date(`${d.day}T12:00:00Z`).getUTCDay();
      expect(top, d.key).toContain(`${weekday}:${d.hour}`);
      const k = localWeekKey(seedSlot(d));
      weeks.set(k, (weeks.get(k) ?? 0) + 1);
    }
    expect([...weeks.entries()]).toEqual([
      ["2026-11-16", 4],
      ["2026-11-23", 4],
      ["2026-11-30", 4],
    ]);
  });

  it("are slotted in Eastern time", () => {
    expect(seedSlot(SEED_DRAFTS[0]).toISOString()).toBe("2026-11-17T15:00:00.000Z");
  });

  it("go to Facebook and Instagram, with a phone number and a link", () => {
    for (const d of SEED_DRAFTS) {
      expect(d.platforms).toEqual(["facebook", "instagram"]);
      expect(d.cta).toContain("{link}");
      expect(seedCta(d, "https://x.test/book")).toContain("https://x.test/book");
    }
  });

  it("never name a street", () => {
    const street = /\b\d+\s+\w+\s+(Court|Ct|Lane|Ln|Road|Rd|Drive|Dr|Way|Street|St|Avenue|Ave)\b/i;
    for (const d of SEED_DRAFTS) expect(`${d.hook} ${d.body} ${d.cta} ${d.photoHint}`, d.key).not.toMatch(street);
  });

  it("reference a job photo, or say why not", () => {
    for (const d of SEED_DRAFTS) {
      if (d.cardStyle === "brand") expect(d.photo).toBeNull();
      else expect(d.photo?.afterPhotoId).toMatch(/^[0-9a-f-]{36}$/);
      expect(d.photoHint.length).toBeGreaterThan(10);
    }
  });
});
