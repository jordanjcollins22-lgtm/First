import { describe, expect, it } from "vitest";

import {
  MIN_HOURS_BETWEEN_POSTS,
  POSTING_SLOTS,
  describeGap,
  duePosts,
  nextPostSlot,
  pairPhotos,
  suggestCaption,
  townFromAddress,
  type PhotoLike,
} from "@/lib/social-post";

function photo(overrides: Partial<PhotoLike> & { id: string; kind: PhotoLike["kind"] }): PhotoLike {
  return {
    zone_id: null,
    zone_name: null,
    created_at: "2026-05-01T10:00:00Z",
    ...overrides,
  };
}

/** The local weekday and hour a UTC instant lands on where the work is. */
function local(date: Date): { weekday: number; hour: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "numeric",
    hour12: false,
  }).formatToParts(date);
  const names = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return {
    weekday: names.indexOf(parts.find((p) => p.type === "weekday")!.value),
    hour: Number(parts.find((p) => p.type === "hour")!.value) % 24,
  };
}

describe("pairing photos", () => {
  it("pairs a before with an after in the same zone", () => {
    const pairs = pairPhotos([
      photo({ id: "b", kind: "before", zone_id: "front", zone_name: "Front bed" }),
      photo({ id: "a", kind: "after", zone_id: "front", zone_name: "Front bed" }),
    ]);

    expect(pairs).toHaveLength(1);
    expect(pairs[0].before.id).toBe("b");
    expect(pairs[0].after.id).toBe("a");
    expect(pairs[0].zoneName).toBe("Front bed");
  });

  it("never pairs across zones", () => {
    // A before of the front next to an after of the back is two photographs,
    // not a transformation.
    const pairs = pairPhotos([
      photo({ id: "b", kind: "before", zone_id: "front" }),
      photo({ id: "a", kind: "after", zone_id: "back" }),
    ]);
    expect(pairs).toEqual([]);
  });

  it("pairs several zones independently", () => {
    const pairs = pairPhotos([
      photo({ id: "fb", kind: "before", zone_id: "front" }),
      photo({ id: "fa", kind: "after", zone_id: "front" }),
      photo({ id: "bb", kind: "before", zone_id: "back" }),
      photo({ id: "ba", kind: "after", zone_id: "back" }),
    ]);
    expect(pairs).toHaveLength(2);
  });

  it("pairs in the order the crew walked it", () => {
    const pairs = pairPhotos([
      photo({ id: "b2", kind: "before", created_at: "2026-05-01T12:00:00Z" }),
      photo({ id: "b1", kind: "before", created_at: "2026-05-01T09:00:00Z" }),
      photo({ id: "a2", kind: "after", created_at: "2026-05-01T16:00:00Z" }),
      photo({ id: "a1", kind: "after", created_at: "2026-05-01T15:00:00Z" }),
    ]);
    expect(pairs.map((p) => [p.before.id, p.after.id])).toEqual([
      ["b1", "a1"],
      ["b2", "a2"],
    ]);
  });

  it("ignores a before with no after to show against it", () => {
    expect(pairPhotos([photo({ id: "b", kind: "before" })])).toEqual([]);
  });

  it("ignores during and issue shots", () => {
    const pairs = pairPhotos([
      photo({ id: "b", kind: "before" }),
      photo({ id: "d", kind: "during" }),
      photo({ id: "i", kind: "issue" }),
      photo({ id: "a", kind: "after" }),
    ]);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].before.id).toBe("b");
  });
});

describe("picking a slot", () => {
  it("always lands on a posting slot", () => {
    const slot = nextPostSlot([], "2026-05-04T08:00:00Z")!;
    const { weekday, hour } = local(slot);
    expect(POSTING_SLOTS.some((s) => s.weekday === weekday && s.hour === hour)).toBe(true);
  });

  it("never picks a time in the past", () => {
    const from = new Date("2026-05-04T08:00:00Z");
    expect(nextPostSlot([], from)!.getTime()).toBeGreaterThan(from.getTime());
  });

  it("skips a slot something is already booked into", () => {
    const first = nextPostSlot([], "2026-05-04T08:00:00Z")!;
    const second = nextPostSlot([first], "2026-05-04T08:00:00Z")!;
    expect(second.getTime()).toBeGreaterThan(first.getTime());
  });

  it("keeps posts a day apart rather than stacking them", () => {
    // Approving five in one sitting should spread them, not dump them.
    const booked: Date[] = [];
    for (let i = 0; i < 5; i++) {
      booked.push(nextPostSlot(booked, "2026-05-04T08:00:00Z")!);
    }

    const gapMs = MIN_HOURS_BETWEEN_POSTS * 3_600_000;
    const times = booked.map((d) => d.getTime()).sort((a, b) => a - b);
    for (let i = 1; i < times.length; i++) {
      expect(times[i] - times[i - 1]).toBeGreaterThanOrEqual(gapMs);
    }
    // Five posts should cover more than a couple of days.
    expect(times[4] - times[0]).toBeGreaterThan(6 * 86_400_000);
  });

  it("holds the local hour across a daylight-saving change", () => {
    // Early November, the weekend the clocks go back.
    const slot = nextPostSlot([], "2026-10-30T12:00:00Z")!;
    const { weekday, hour } = local(slot);
    expect(POSTING_SLOTS.some((s) => s.weekday === weekday && s.hour === hour)).toBe(true);

    const later = nextPostSlot([slot], "2026-10-30T12:00:00Z")!;
    const nextLocal = local(later);
    expect(
      POSTING_SLOTS.some((s) => s.weekday === nextLocal.weekday && s.hour === nextLocal.hour)
    ).toBe(true);
  });
});

describe("what is due", () => {
  const posts = [
    { id: "1", status: "scheduled", scheduledFor: "2026-05-05T14:00:00Z" },
    { id: "2", status: "scheduled", scheduledFor: "2026-05-09T14:00:00Z" },
    { id: "3", status: "approved", scheduledFor: "2026-05-01T14:00:00Z" },
    { id: "4", status: "posted", scheduledFor: "2026-05-01T14:00:00Z" },
    { id: "5", status: "scheduled", scheduledFor: null },
  ];

  it("returns only scheduled posts whose time has come", () => {
    expect(duePosts(posts, "2026-05-06T00:00:00Z").map((p) => p.id)).toEqual(["1"]);
  });

  it("never returns one twice once it has posted", () => {
    expect(duePosts(posts, "2026-06-01T00:00:00Z").map((p) => p.id)).toEqual(["1", "2"]);
  });
});

describe("captions", () => {
  it("names the work, the place and the number", () => {
    const caption = suggestCaption({
      services: ["Mulch install"],
      zoneName: "Front bed",
      city: "Bel Air",
      phone: "443-819-1521",
    });
    expect(caption).toContain("Mulch install");
    expect(caption).toContain("Bel Air");
    expect(caption).toContain("Front bed");
    expect(caption).toContain("443-819-1521");
  });

  it("falls back to the county when there is no city on the job", () => {
    const caption = suggestCaption({ services: [], phone: "443-819-1521" });
    expect(caption).toContain("Harford County");
  });
});

describe("where the work was", () => {
  it("takes the town out of a full address", () => {
    expect(townFromAddress("123 Main St, Bel Air, MD 21014")).toBe("Bel Air");
  });

  it("never returns the street line", () => {
    // The one rule: a public caption says the town, never whose house.
    expect(townFromAddress("123 Main St, Bel Air, MD 21014")).not.toContain("Main St");
    expect(townFromAddress("123 Main St")).toBeNull();
  });

  it("says nothing rather than guessing", () => {
    expect(townFromAddress(null)).toBeNull();
    expect(townFromAddress("")).toBeNull();
    expect(townFromAddress("MD 21014")).toBeNull();
  });
});

describe("what is missing", () => {
  it("says nothing when there is a usable pair", () => {
    expect(
      describeGap([
        photo({ id: "b", kind: "before", zone_id: "front" }),
        photo({ id: "a", kind: "after", zone_id: "front" }),
      ])
    ).toBeNull();
  });

  it("names an empty job", () => {
    expect(describeGap([])?.code).toBe("none");
  });

  it("names a job that only got the before", () => {
    expect(describeGap([photo({ id: "b", kind: "before" })])?.code).toBe("before_only");
  });

  it("names a job that only got the after", () => {
    expect(describeGap([photo({ id: "a", kind: "after" })])?.code).toBe("after_only");
  });

  it("catches both-but-never-the-same-place", () => {
    // The one that looks finished on the job page and produces nothing.
    expect(
      describeGap([
        photo({ id: "b", kind: "before", zone_id: "front" }),
        photo({ id: "a", kind: "after", zone_id: "back" }),
      ])?.code
    ).toBe("unpaired");
  });

  it("does not count during or issue shots as either half", () => {
    expect(describeGap([photo({ id: "d", kind: "during" })])?.code).toBe("none");
  });
});
