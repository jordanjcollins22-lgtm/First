import { describe, expect, it } from "vitest";

import { bookingSource, carryAdParams, cleanAdClick, isPaidClick, readAdClick } from "@/lib/ad-click";

describe("readAdClick", () => {
  it("reads the click ids, the tags and Meta's cookie", () => {
    expect(readAdClick("?gclid=Cj0KCQ_abc-123&utm_campaign=fall refresh&org=x", "a=1; _fbp=fb.1.1700000000000.123456789")).toEqual({
      gclid: "Cj0KCQ_abc-123",
      utm_campaign: "fall refresh",
      fbp: "fb.1.1700000000000.123456789",
    });
  });

  it("is null when nothing came from an ad", () => {
    expect(readAdClick("?org=js&rec=abcd")).toBeNull();
  });

  it("drops anything that isn't a plain id", () => {
    expect(readAdClick("?fbclid=<script>&gclid=ok_123")).toEqual({ gclid: "ok_123" });
  });
});

describe("carryAdParams", () => {
  it("copies the ad parameters and nothing else", () => {
    const to = new URLSearchParams("org=js&rec=abcd");
    carryAdParams(new URLSearchParams("fbclid=IwAR1&secret=x"), to);
    expect(to.toString()).toBe("org=js&rec=abcd&fbclid=IwAR1");
  });
});

describe("bookingSource", () => {
  it("names the ad, the link, or the page", () => {
    expect(bookingSource({ gclid: "a", utm_campaign: "beds" }, null)).toBe("Google ad · beds");
    expect(bookingSource({ fbclid: "a" }, "abcd")).toBe("Facebook ad");
    expect(bookingSource({ utm_source: "nextdoor" }, null)).toBe("nextdoor");
    expect(bookingSource(null, "abcd")).toBe("Tracked link abcd");
    expect(bookingSource(null, null)).toBe("Booked online");
  });

  it("counts only real ad clicks as paid", () => {
    expect(isPaidClick({ fbclid: "a" })).toBe(true);
    expect(isPaidClick({ utm_source: "newsletter" })).toBe(false);
    expect(isPaidClick(null)).toBe(false);
  });
});

describe("cleanAdClick", () => {
  it("keeps only what passes the checks", () => {
    expect(cleanAdClick({ fbclid: "IwAR1", fbp: "fb.1.17.99", evil: "x", gclid: 5 })).toEqual({ fbclid: "IwAR1", fbp: "fb.1.17.99" });
    expect(cleanAdClick("nope")).toBeNull();
  });
});
