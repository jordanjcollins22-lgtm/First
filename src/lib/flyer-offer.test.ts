import { describe, expect, it } from "vitest";

import {
  ACCEPTED_TYPES,
  artworkKindBlurb,
  artworkKindLabel,
  artworkKindPromise,
  inviteText,
  artworkSpec,
  breakEvenJobs,
  breakEvenLine,
  checkArtwork,
  costPerHome,
  costPerHomeCents,
  FLYERS_PER_RUN,
  isSoldOut,
  MAX_UPLOAD_BYTES,
  offerStats,
  specLine,
  SPOT_PRICE_CENTS,
  SPOTS_PER_RUN,
  spotsLabel,
  spotsLeft,
  availabilityLine,
} from "./flyer-offer";

describe("the offer itself", () => {
  it("is 2,500 flyers for $300", () => {
    expect(FLYERS_PER_RUN).toBe(2500);
    expect(SPOT_PRICE_CENTS).toBe(30_000);
  });

  it("keeps the top right of each side for us", () => {
    // The front's carries the postage indicia; the back's is where an eye
    // lands on a page nobody chose to read.
    expect(SPOTS_PER_RUN).toBe(6);
  });
});

describe("cost per home", () => {
  it("is the price divided by the doors and nothing else", () => {
    expect(costPerHomeCents()).toBe(12);
  });

  it("reads in cents rather than as a fraction of a dollar", () => {
    // "12c" lands; "$0.12" reads like a rounding error.
    expect(costPerHome()).toBe("12c");
  });
});

describe("offerStats", () => {
  it("gives the three numbers somebody actually asks about", () => {
    const stats = offerStats();
    expect(stats.map((s) => s.label)).toEqual(["Homes reached", "Cost per home", "Availability"]);
  });

  it("quotes no industry statistics", () => {
    // Everything here is arithmetic on our own figures. A response rate
    // nobody can check is worse than no claim at all on a page taking cards.
    const text = offerStats()
      .map((s) => `${s.value} ${s.detail}`)
      .join(" ")
      .toLowerCase();
    expect(text).not.toMatch(/response rate|conversion rate|% of|average return/);
  });

  it("uses no dashes", () => {
    for (const stat of offerStats()) {
      expect(`${stat.label} ${stat.detail}`).not.toMatch(/[—–]/);
    }
  });
});

describe("break-even", () => {
  it("says how many jobs pay for it", () => {
    expect(breakEvenJobs(30_000)).toBe(1);
    expect(breakEvenJobs(15_000)).toBe(2);
    expect(breakEvenJobs(20_000)).toBe(2); // rounds up: one and a half is two
  });

  it("says nothing when we have no figure to work from", () => {
    expect(breakEvenJobs(0)).toBeNull();
    expect(breakEvenLine(0)).toBeNull();
  });

  it("reads naturally for one job", () => {
    expect(breakEvenLine(50_000)).toBe("One job pays for the whole run.");
    expect(breakEvenLine(10_000)).toBe("3 jobs pay for the whole run.");
  });
});

describe("the artwork spec", () => {
  it("matches the tile the flyer actually prints", () => {
    const spec = artworkSpec();
    expect(spec.widthIn).toBe(4);
    expect(spec.heightIn).toBe(4.75);
    expect(spec.pixelWidth).toBe(1200);
    expect(spec.pixelHeight).toBe(1425);
  });

  it("says the size in one line somebody can follow", () => {
    const line = specLine();
    expect(line).toContain('4" wide by 4.75" tall');
    expect(line).toContain("1200 by 1425");
    expect(line).toContain("300 DPI");
  });
});

describe("checkArtwork", () => {
  const good = { type: "image/png", bytes: 500_000, width: 1200, height: 1425 };

  it("passes artwork at the right size", () => {
    expect(checkArtwork(good)).toEqual({ verdict: "ok", message: "That will print nicely." });
  });

  it("rejects a file that cannot be printed", () => {
    expect(checkArtwork({ ...good, type: "image/gif" }).verdict).toBe("reject");
    expect(checkArtwork({ ...good, type: "text/plain" }).verdict).toBe("reject");
  });

  it("accepts the formats a phone or a designer produces", () => {
    for (const type of ACCEPTED_TYPES) {
      expect(checkArtwork({ ...good, type }).verdict, type).not.toBe("reject");
    }
  });

  it("rejects an empty or oversized file", () => {
    expect(checkArtwork({ ...good, bytes: 0 }).verdict).toBe("reject");
    expect(checkArtwork({ ...good, bytes: MAX_UPLOAD_BYTES + 1 }).verdict).toBe("reject");
  });

  it("warns rather than blocks on something that will print soft", () => {
    // Caught here it is a two minute fix. Caught at the printer it is a
    // refund and an apology.
    const check = checkArtwork({ ...good, width: 400, height: 475 });
    expect(check.verdict).toBe("warn");
    expect(check.message).toContain("1200 by 1425");
    expect(check.message).not.toContain("cropped");
  });

  it("warns when the shape is wrong, because cropping eats the phone number", () => {
    const check = checkArtwork({ ...good, width: 2000, height: 1500 });
    expect(check.verdict).toBe("warn");
    expect(check.message).toContain("cropped");
  });

  it("says so when a design is both the wrong shape and too small", () => {
    // Told off for only one of them, it comes back a second time still wrong.
    const check = checkArtwork({ ...good, width: 1600, height: 900 });
    expect(check.message).toContain("cropped");
    expect(check.message).toContain("soft in print");
  });

  it("allows a little slack in the proportions", () => {
    expect(checkArtwork({ ...good, width: 1200, height: 1400 }).verdict).toBe("ok");
  });

  it("takes a PDF on trust, since a browser cannot measure its page", () => {
    const check = checkArtwork({ type: "application/pdf", bytes: 900_000, width: null, height: null });
    expect(check.verdict).toBe("ok");
    expect(check.message).toContain("preview");
  });
});

describe("spots left", () => {
  it("counts down from six", () => {
    expect(spotsLeft(0)).toBe(6);
    expect(spotsLeft(5)).toBe(1);
    expect(spotsLeft(6)).toBe(0);
  });

  it("never goes negative or above the total", () => {
    expect(spotsLeft(99)).toBe(0);
    expect(spotsLeft(-3)).toBe(6);
  });

  it("gives the office the real count, since they decide whether to keep selling", () => {
    expect(spotsLabel(0)).toBe("6 of 6 spots left on this run.");
    expect(spotsLabel(5)).toBe("One spot left on this run.");
  });

  it("says so plainly when the run is full", () => {
    expect(spotsLabel(6)).toBe("This run is full. Ask us about the next one.");
    expect(isSoldOut(6)).toBe(true);
    expect(isSoldOut(5)).toBe(false);
  });
});

describe("inviteText", () => {
  const text = inviteText({
    organizationName: "JS Landscaping",
    link: "https://app.example.com/flyer/js",
  });

  it("says who it is from, since it lands after a phone call", () => {
    expect(text).toContain("JS Landscaping");
  });

  it("carries the two numbers that decide it", () => {
    expect(text).toContain("2,500");
    expect(text).toContain("$300.00");
  });

  it("puts the link last", () => {
    // A link in the middle of a text is a text nobody finishes reading.
    expect(text.endsWith("https://app.example.com/flyer/js")).toBe(true);
  });

  it("promises only what the page delivers", () => {
    // Upload, look, pay. Two minutes is a claim we can keep.
    expect(text).toContain("two minutes");
    expect(text).toContain("upload your ad");
  });

  it("uses the run's own figures when they differ", () => {
    const custom = inviteText({
      organizationName: "X",
      link: "l",
      flyerCount: 5000,
      priceCents: 50_000,
    });
    expect(custom).toContain("5,000");
    expect(custom).toContain("$500.00");
  });

  it("uses no dashes", () => {
    expect(text).not.toMatch(/[—–]/);
  });
});

describe("what they are sending us", () => {
  it("offers the second option as plainly as the first", () => {
    // Most local businesses do not have a print-ready file. Refusing those
    // loses the sale.
    expect(artworkKindLabel("ready")).toBe("I have my advert ready");
    expect(artworkKindLabel("reference")).toBe("Make the advert for me");
  });

  it("names the size only where the size matters", () => {
    expect(artworkKindBlurb("ready")).toContain("1200 by 1425");
    expect(artworkKindBlurb("reference")).not.toContain("1200");
  });

  it("says what counts as a reference, in things a business actually has", () => {
    const blurb = artworkKindBlurb("reference").toLowerCase();
    for (const thing of ["old advert", "van", "logo"]) {
      expect(blurb, thing).toContain(thing);
    }
  });

  it("promises an approval before printing when we are designing it", () => {
    // The preview cannot show them what they are getting, so the promise has
    // to replace it.
    expect(artworkKindPromise("reference")).toContain("approve before");
    expect(artworkKindPromise("ready")).toContain("exactly what will print");
  });

  it("uses no dashes", () => {
    for (const kind of ["ready", "reference"] as const) {
      expect(`${artworkKindLabel(kind)} ${artworkKindBlurb(kind)} ${artworkKindPromise(kind)}`)
        .not.toMatch(/[—–]/);
    }
  });
});

describe("availabilityLine", () => {
  it("never counts down at an advertiser", () => {
    // A number that drops as somebody reads is a countdown, and a countdown
    // on a page taking card payments reads as pressure whether it is true or
    // not. It also tells a competitor how the run is selling.
    for (const taken of [0, 1, 3, 5]) {
      const line = availabilityLine(taken);
      expect(line, `taken ${taken}`).toBe("Limited availability on this run.");
      expect(line).not.toMatch(/\d/);
    }
  });

  it("still says plainly when there is nothing left to sell", () => {
    expect(availabilityLine(6)).toBe("This run is full. Ask us about the next one.");
  });

  it("uses no dashes", () => {
    expect(availabilityLine(2)).not.toMatch(/[—–]/);
  });
});
