import { describe, expect, it } from "vitest";

import {
  ACCEPTED_TYPES,
  artworkKindBlurb,
  artworkKindLabel,
  artworkKindPromise,
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
  nextRunName,
} from "./flyer-offer";

describe("the offer itself", () => {
  it("is 2,500 flyers for $300", () => {
    expect(FLYERS_PER_RUN).toBe(2500);
    expect(SPOT_PRICE_CENTS).toBe(30_000);
  });

  it("keeps the front top right for us and sells the rest", () => {
    // That corner carries the postage indicia, so our artwork is the one cut
    // to leave room for it.
    expect(SPOTS_PER_RUN).toBe(7);
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
  it("counts down from seven", () => {
    expect(spotsLeft(0)).toBe(7);
    expect(spotsLeft(6)).toBe(1);
    expect(spotsLeft(7)).toBe(0);
  });

  it("never goes negative or above the total", () => {
    expect(spotsLeft(99)).toBe(0);
    expect(spotsLeft(-3)).toBe(7);
  });

  it("gives the office the real count, since they decide whether to keep selling", () => {
    expect(spotsLabel(0)).toBe("7 of 7 spots left on this run.");
    expect(spotsLabel(6)).toBe("One spot left on this run.");
  });

  it("says so plainly when the run is full", () => {
    expect(spotsLabel(7)).toBe("This run is full. Ask us about the next one.");
    expect(isSoldOut(7)).toBe(true);
    expect(isSoldOut(6)).toBe(false);
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
    expect(availabilityLine(7)).toBe("This run is full. Ask us about the next one.");
  });

  it("uses no dashes", () => {
    expect(availabilityLine(2)).not.toMatch(/[—–]/);
  });
});

describe("nextRunName", () => {
  it("numbers off the run it follows", () => {
    expect(nextRunName("October run", ["October run"])).toBe("October run 2");
  });

  it("keeps counting rather than restarting", () => {
    // A third run is "October run 3", not "October run 2 2".
    expect(nextRunName("October run 2", ["October run", "October run 2"])).toBe("October run 3");
  });

  it("skips a name somebody already used", () => {
    // Two runs with one name is two runs nobody can tell apart on a
    // printer's invoice.
    expect(nextRunName("October run", ["October run", "October run 2", "October run 3"])).toBe(
      "October run 4"
    );
  });

  it("is not confused by casing or stray spaces", () => {
    expect(nextRunName("  October run  ", ["october run 2"])).toBe("October run 3");
  });

  it("copes with a run named only a number", () => {
    expect(nextRunName("2", ["2"])).toBe("Run 2");
  });

  it("always returns something usable", () => {
    const crowded = Array.from({ length: 250 }, (_, i) => `Run ${i + 1}`);
    expect(nextRunName("Run", crowded).length).toBeGreaterThan(0);
  });
});
