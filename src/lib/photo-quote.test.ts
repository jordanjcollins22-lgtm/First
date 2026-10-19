import { describe, expect, it } from "vitest";

import { BUDGET_RANGES } from "@/lib/booking-budget-ranges";
import { bracketTop, parseIdeas, readLine, readPhotoQuoteSettings, routeForBudget, visitLinkMessage } from "@/lib/photo-quote";
import { cleanAnswers, cleanSpots, mergeSpots, nextSpotId, MAX_SPOTS, type PhotoQuoteSpot } from "@/lib/evaluation-intake";
import { groundToPicture, layoutLot, pictureToGround, pinView, type LotData } from "@/lib/lot-map";

const on = (line: number) => ({ enabled: true, line });

describe("budget brackets", () => {
  it("reads the top of every bracket we offer", () => {
    expect(BUDGET_RANGES.map(bracketTop)).toEqual([null, 1500, 2500, 5000, 15000, 30000, Infinity]);
  });

  it("has no top for a blank, or for a bracket we never offered", () => {
    expect(bracketTop("")).toBeNull();
    expect(bracketTop(null)).toBeNull();
    expect(bracketTop("Under $2,500")).toBeNull();
    expect(bracketTop("$1")).toBeNull();
  });
});

describe("photo quote or visit", () => {
  it("quotes from photos only when the whole bracket is under the line", () => {
    expect(routeForBudget("Under $1,500", on(1500))).toBe("photo_quote");
    expect(routeForBudget("$1,500 – $2,500", on(1500))).toBe("visit");
    expect(routeForBudget("$1,500 – $2,500", on(2500))).toBe("photo_quote");
    // The line in the middle of a bracket: a visit, rather than a big job off three photos.
    expect(routeForBudget("$2,500 – $5,000", on(3000))).toBe("visit");
    expect(routeForBudget("$2,500 – $5,000", on(5000))).toBe("photo_quote");
  });

  it("always visits for not sure, a blank, the open-ended top, or the switch off", () => {
    expect(routeForBudget("Not sure yet", on(1_000_000))).toBe("visit");
    expect(routeForBudget("", on(5000))).toBe("visit");
    expect(routeForBudget("$30,000+", on(1_000_000))).toBe("visit");
    expect(routeForBudget("Under $1,500", { enabled: false, line: 1500 })).toBe("visit");
    expect(routeForBudget("Under $1,500", null)).toBe("visit");
    expect(routeForBudget("Under $1,500", on(0))).toBe("visit");
  });
});

describe("the owner's setting", () => {
  it("is off at $1,500 when nothing is stored", () => {
    expect(readPhotoQuoteSettings(null)).toEqual({ enabled: false, line: 1500 });
    expect(readPhotoQuoteSettings({ photo_quotes: true, photo_quote_line: "2500" })).toEqual({ enabled: true, line: 2500 });
    expect(readPhotoQuoteSettings({ photo_quotes: true, photo_quote_line: -4 })).toEqual({ enabled: true, line: 1500 });
  });

  it("reads a line typed with or without the dollar sign and commas", () => {
    expect(readLine("1500")).toBe(1500);
    expect(readLine("$2,500")).toBe(2500);
    expect(readLine(" 999.50 ")).toBe(999.5);
    expect(readLine("")).toBeNaN();
    expect(readLine("0")).toBeNaN();
    expect(readLine("lots")).toBeNaN();
    expect(readLine("5000000")).toBeNaN();
  });
});

describe("ideas from the photos", () => {
  it("takes one short suggestion per line, without bullets, repeats or prices", () => {
    const raw = [
      "1. Edge the beds and top up the mulch.",
      "- Trim the overgrown boxwoods by the steps",
      "* **Pull the weeds along the walkway**",
      "- edge the beds and top up the mulch",
      "Add a stone border for about $400",
      "",
      "ok",
      "Reseed the thin patch by the downspout",
      "Aerate the lawn in the fall",
    ].join("\n");
    expect(parseIdeas(raw)).toEqual([
      "Edge the beds and top up the mulch",
      "Trim the overgrown boxwoods by the steps",
      "Pull the weeds along the walkway",
      "Reseed the thin patch by the downspout",
    ]);
  });

  it("is nothing when the model said nothing", () => {
    expect(parseIdeas("")).toEqual([]);
  });
});

describe("a photo quote's areas", () => {
  const spot = (id: string, extra: Partial<PhotoQuoteSpot> = {}): PhotoQuoteSpot => ({
    id,
    lng: -76.35,
    lat: 39.53,
    wants: "Mulch",
    services: ["beds"],
    noPhotos: false,
    ideas: [],
    ...extra,
  });

  it("keeps only real places, our services and short words", () => {
    const cleaned = cleanSpots([
      spot("spot-1", { services: ["beds", "made-up"], wants: "x".repeat(900) }),
      spot("spot-1"),
      { ...spot("spot-2"), lat: "39" },
      spot("area-3"),
      spot("spot-4", { lat: 120 }),
      spot("spot-5", { ideas: [{ text: "Edge the beds", interested: true }, { text: "", interested: true }] }),
    ]);
    expect(cleaned.map((s) => s.id)).toEqual(["spot-1", "spot-5"]);
    expect(cleaned[0].services).toEqual(["beds"]);
    expect(cleaned[0].wants).toHaveLength(600);
    expect(cleaned[1].ideas).toEqual([{ text: "Edge the beds", interested: true }]);
    expect(cleanSpots("nope")).toEqual([]);
  });

  it("keeps a photo's spot even before the spot is saved", () => {
    const path = "11111111-2222-3333-4444-555555555555/intake-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.jpg";
    const answers = cleanAnswers({ photos: [path], photo_areas: { [path]: "spot-3" } });
    expect(answers.photo_areas[path]).toBe("spot-3");
    expect(cleanAnswers({ photos: [path], photo_areas: { [path]: "attic" } }).photo_areas[path]).toBeUndefined();
  });

  it("keeps the server's wording of the ideas, and the client's ticks", () => {
    const stored = [spot("spot-1", { ideas: [{ text: "Edge the beds", interested: false }, { text: "Trim the shrubs", interested: false }] })];
    const sent = [
      spot("spot-1", { wants: "Changed", ideas: [{ text: "Edge the beds", interested: true }, { text: "Free patio", interested: true }] }),
      spot("spot-2", { ideas: [{ text: "Made up", interested: true }] }),
    ];
    expect(mergeSpots(stored, sent)).toEqual([
      spot("spot-1", { wants: "Changed", ideas: [{ text: "Edge the beds", interested: true }, { text: "Trim the shrubs", interested: false }] }),
      spot("spot-2", { ideas: [] }),
    ]);
  });

  it("numbers a new area with the first free number, up to the most a form takes", () => {
    expect(nextSpotId([])).toBe("spot-1");
    expect(nextSpotId([{ id: "spot-1" }, { id: "spot-3" }])).toBe("spot-2");
    expect(nextSpotId(Array.from({ length: MAX_SPOTS }, (_, i) => ({ id: `spot-${i + 1}` })))).toBeNull();
  });
});

describe("a tap on the picture", () => {
  it("lands on the ground where it was tapped, and back", () => {
    const view = pinView(-76.35, 39.53, 640, 440);
    const ground = pictureToGround(view, [500, 100]);
    const [x, y] = groundToPicture(view, ground);
    expect(x).toBeCloseTo(500, 6);
    expect(y).toBeCloseTo(100, 6);
    // The middle of the picture is the pin.
    const middle = pictureToGround(view, [320, 220]);
    expect(middle[0]).toBeCloseTo(-76.35, 9);
    expect(middle[1]).toBeCloseTo(39.53, 9);
  });

  it("works on a lot picture turned to face the street", () => {
    const lot: LotData = {
      ring: [
        [-76.3502, 39.5299],
        [-76.3498, 39.5299],
        [-76.3498, 39.5302],
        [-76.3502, 39.5302],
        [-76.3502, 39.5299],
      ],
      footprint: null,
      front: [-76.35, 39.5296],
      frontRoad: "Main St",
      lotSqft: 9000,
      structureSqft: 2000,
    };
    const layout = layoutLot(lot, 640, 440, 1);
    expect(layout.bearing).not.toBe(0);
    const corner = groundToPicture(layout, lot.ring[0]);
    expect(corner[0]).toBeCloseTo(layout.parcel[0][0], 6);
    expect(corner[1]).toBeCloseTo(layout.parcel[0][1], 6);
    const back = pictureToGround(layout, corner);
    expect(back[0]).toBeCloseTo(lot.ring[0][0], 9);
    expect(back[1]).toBeCloseTo(lot.ring[0][1], 9);
  });
});

describe("the link to book a visit", () => {
  it("greets them by first name and carries the link", () => {
    expect(visitLinkMessage({ clientName: "Pat Jones", link: "https://x.test/book?visit=1" })).toBe(
      "Hi Pat, thanks for the photos. This one is worth us seeing in person before we price it, so we can get it right. Pick a time that suits you here: https://x.test/book?visit=1"
    );
    expect(visitLinkMessage({ clientName: null, link: "L" })).toMatch(/^Thanks for the photos\./);
  });
});
