import { describe, expect, it } from "vitest";

import {
  absolute,
  isPreview,
  payPath,
  previewResult,
  proposalPath,
  schedulePath,
  PREVIEW_BLOCKED,
} from "./proposal-flow";

const TOKEN = "abc123";

describe("the three steps", () => {
  it("each have their own URL", () => {
    expect(proposalPath(TOKEN)).toBe("/proposal/abc123");
    expect(payPath(TOKEN)).toBe("/proposal/abc123/pay");
    expect(schedulePath(TOKEN)).toBe("/proposal/abc123/schedule");
  });

  it("are all under the same token, so a link still identifies one client", () => {
    for (const path of [proposalPath(TOKEN), payPath(TOKEN), schedulePath(TOKEN)]) {
      expect(path.startsWith(`/proposal/${TOKEN}`)).toBe(true);
    }
  });
});

describe("absolute", () => {
  it("builds the address Stripe redirects a browser to", () => {
    expect(absolute("https://app.example.com", payPath(TOKEN))).toBe(
      "https://app.example.com/proposal/abc123/pay"
    );
  });

  it("does not double the slash on a base that ends in one", () => {
    expect(absolute("https://app.example.com/", "/x")).toBe("https://app.example.com/x");
  });

  it("falls back to the relative path when nothing told us our own address", () => {
    expect(absolute("", "/x")).toBe("/x");
  });
});

describe("isPreview", () => {
  it("is only the flag we set ourselves", () => {
    expect(isPreview("1")).toBe(true);
    expect(isPreview(["1"])).toBe(true);
    expect(isPreview("true")).toBe(false);
    expect(isPreview(undefined)).toBe(false);
  });
});

describe("previewResult", () => {
  it("looks like a refused action, so no caller has to learn a new shape", () => {
    expect(previewResult()).toEqual({ ok: false, message: PREVIEW_BLOCKED });
  });

  it("says why, and says it is only a preview", () => {
    expect(PREVIEW_BLOCKED).toMatch(/preview/i);
    expect(PREVIEW_BLOCKED).not.toMatch(/[—–]/);
  });
});
