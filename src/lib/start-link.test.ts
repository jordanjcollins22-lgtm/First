import { describe, expect, it } from "vitest";

import { bookingLinkFor, readStartAddress } from "./start-link";

const found = { fullAddress: "3 Idlewild Court, Bel Air, Maryland 21014, United States", lat: 39.53134, lng: -76.33782 };

describe("the landing page's link into booking", () => {
  it("carries the address there and reads it back the same", () => {
    const link = bookingLinkFor(found, { located: false });
    expect(link.startsWith("/book?")).toBe(true);
    const back = readStartAddress(new URLSearchParams(link.split("?")[1]));
    expect(back).toEqual({ address: { id: "from-start", ...found }, located: false });
  });

  it("says when the address came from the phone's location", () => {
    const link = bookingLinkFor(found, { located: true });
    expect(readStartAddress(new URLSearchParams(link.split("?")[1]))?.located).toBe(true);
  });

  it("keeps an affiliate's ref so the booking still credits them, and nothing else", () => {
    const link = bookingLinkFor(found, { located: false, carry: new URLSearchParams("ref=jace&utm=x") });
    const params = new URLSearchParams(link.split("?")[1]);
    expect(params.get("ref")).toBe("jace");
    expect(params.get("utm")).toBeNull();
  });

  it("ignores a link with no address, or a place that isn't one", () => {
    expect(readStartAddress(new URLSearchParams(""))).toBeNull();
    expect(readStartAddress(new URLSearchParams("address=x&lat=abc&lng=1"))).toBeNull();
    expect(readStartAddress(new URLSearchParams("address=x&lat=95&lng=1"))).toBeNull();
    expect(readStartAddress(new URLSearchParams("address=x&lat=0&lng=0"))).toBeNull();
  });
});
