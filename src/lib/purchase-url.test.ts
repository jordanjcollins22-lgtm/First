import { describe, expect, it } from "vitest";

import { describePurchaseUrl, safePurchaseUrl } from "@/lib/purchase-url";

describe("safePurchaseUrl", () => {
  it("keeps an ordinary link", () => {
    expect(safePurchaseUrl("https://www.uline.com/product/123")).toBe(
      "https://www.uline.com/product/123"
    );
  });

  it("assumes https for a bare domain, because that is what people paste", () => {
    expect(safePurchaseUrl("uline.com/product/123")).toBe("https://uline.com/product/123");
  });

  it("keeps plain http", () => {
    expect(safePurchaseUrl("http://supplier.local.example.com")).toBe(
      "http://supplier.local.example.com/"
    );
  });

  it("refuses a javascript: link", () => {
    // This ends up in an href other people click. Anything but http(s) is
    // somebody else's code running inside the app as them.
    expect(safePurchaseUrl("javascript:alert(1)")).toBeNull();
    expect(safePurchaseUrl("JavaScript:alert(1)")).toBeNull();
  });

  it("refuses data: and file: links", () => {
    expect(safePurchaseUrl("data:text/html,<script>alert(1)</script>")).toBeNull();
    expect(safePurchaseUrl("file:///etc/passwd")).toBeNull();
  });

  it("refuses something with no host to go to", () => {
    expect(safePurchaseUrl("not a url")).toBeNull();
    expect(safePurchaseUrl("https://")).toBeNull();
  });

  it("treats blank as nothing rather than as an error", () => {
    expect(safePurchaseUrl("")).toBeNull();
    expect(safePurchaseUrl("   ")).toBeNull();
    expect(safePurchaseUrl(null)).toBeNull();
    expect(safePurchaseUrl(undefined)).toBeNull();
  });

  it("trims what somebody pasted with a space on the end", () => {
    expect(safePurchaseUrl("  https://uline.com  ")).toBe("https://uline.com/");
  });
});

describe("describePurchaseUrl", () => {
  it("shows the shop rather than the whole tracking query", () => {
    expect(describePurchaseUrl("https://www.uline.com/product/123?utm_source=x&sid=999")).toBe(
      "uline.com"
    );
  });

  it("hands back anything it cannot parse rather than blanking the row", () => {
    expect(describePurchaseUrl("nonsense")).toBe("nonsense");
  });
});
