import { describe, expect, it } from "vitest";

import { appUrl, normalizeBaseUrl, resolveBaseUrl } from "@/lib/app-url";

describe("normalizeBaseUrl", () => {
  it("adds https when somebody typed a bare domain", () => {
    // Which is what people type into an env var box, most of the time.
    expect(normalizeBaseUrl("app.jslandscapingmd.com")).toBe("https://app.jslandscapingmd.com");
  });

  it("leaves an explicit scheme alone", () => {
    expect(normalizeBaseUrl("https://app.example.com")).toBe("https://app.example.com");
    expect(normalizeBaseUrl("http://localhost:3000")).toBe("http://localhost:3000");
  });

  it("trims trailing slashes and stray whitespace", () => {
    expect(normalizeBaseUrl("  https://app.example.com//  ")).toBe("https://app.example.com");
  });

  it("treats blank as unset rather than as a URL", () => {
    expect(normalizeBaseUrl("")).toBe("");
    expect(normalizeBaseUrl("   ")).toBe("");
  });
});

describe("resolveBaseUrl", () => {
  it("prefers the configured domain over the host that served the request", () => {
    // The whole point: a proposal must not go out as a preview-deployment URL.
    expect(
      resolveBaseUrl({
        configured: "app.jslandscapingmd.com",
        host: "first-git-abc123.vercel.app",
        proto: "https",
      })
    ).toBe("https://app.jslandscapingmd.com");
  });

  it("falls back to the request host when no domain is set", () => {
    expect(resolveBaseUrl({ configured: "", host: "example.vercel.app", proto: "https" })).toBe(
      "https://example.vercel.app"
    );
  });

  it("keeps http for a local host, since that is what served it", () => {
    expect(resolveBaseUrl({ configured: "", host: "localhost:3000", proto: "http" })).toBe(
      "http://localhost:3000"
    );
  });

  it("assumes https when the proxy did not say", () => {
    expect(resolveBaseUrl({ configured: "", host: "example.com" })).toBe("https://example.com");
  });

  it("returns nothing rather than a broken URL when it has neither", () => {
    expect(resolveBaseUrl({ configured: "", host: null })).toBe("");
  });
});

describe("appUrl", () => {
  it("joins without doubling the slash", () => {
    expect(appUrl("https://app.example.com", "/proposal/abc")).toBe("https://app.example.com/proposal/abc");
    expect(appUrl("https://app.example.com/", "proposal/abc")).toBe("https://app.example.com/proposal/abc");
  });

  it("keeps a query string intact", () => {
    expect(appUrl("https://app.example.com", "/book?ref=jeff")).toBe("https://app.example.com/book?ref=jeff");
  });

  it("returns a relative path when there is no base, which still works in-app", () => {
    expect(appUrl("", "/proposal/abc")).toBe("/proposal/abc");
  });
});
