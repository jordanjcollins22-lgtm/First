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

  it("uses Vercel's production domain with nothing configured", () => {
    // The usual case: a custom domain is attached to the project and nobody
    // has had to set anything in the app.
    expect(
      resolveBaseUrl({
        configured: "",
        productionDomain: "app.jslandscapingmd.com",
        host: "first-git-abc123.vercel.app",
        proto: "https",
      })
    ).toBe("https://app.jslandscapingmd.com");
  });

  it("lets an explicit override beat the production domain", () => {
    // For a project with several custom domains, where Vercel's pick is not
    // the one clients should see.
    expect(
      resolveBaseUrl({
        configured: "book.jslandscapingmd.com",
        productionDomain: "app.jslandscapingmd.com",
        host: "x.vercel.app",
      })
    ).toBe("https://book.jslandscapingmd.com");
  });

  it("writes links to the real site even from a preview deployment", () => {
    const link = resolveBaseUrl({
      configured: "",
      productionDomain: "app.jslandscapingmd.com",
      host: "first-git-feature-branch.vercel.app",
    });
    expect(link).not.toContain("vercel.app");
  });

  it("falls back to the request host when there is neither", () => {
    expect(resolveBaseUrl({ configured: "", host: "example.vercel.app", proto: "https" })).toBe(
      "https://example.vercel.app"
    );
  });

  it("keeps http for a local host, since that is what served it", () => {
    // Locally there is no production domain either, so this still has to work.
    expect(
      resolveBaseUrl({ configured: "", productionDomain: "", host: "localhost:3000", proto: "http" })
    ).toBe("http://localhost:3000");
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
