import { describe, expect, it } from "vitest";

import { hashBytes, looksLikeHash } from "./screenshot-hash";

describe("hashBytes", () => {
  it("gives the same picture the same fingerprint and a different one a different one", async () => {
    const a = new TextEncoder().encode("one picture").buffer as ArrayBuffer;
    const b = new TextEncoder().encode("one picture").buffer as ArrayBuffer;
    const c = new TextEncoder().encode("another picture").buffer as ArrayBuffer;
    const ha = await hashBytes(a);
    expect(ha).toBe(await hashBytes(b));
    expect(ha).not.toBe(await hashBytes(c));
    expect(looksLikeHash(ha)).toBe(true);
  });

  it("knows what a fingerprint looks like", () => {
    expect(looksLikeHash("abc")).toBe(false);
    expect(looksLikeHash("g".repeat(64))).toBe(false);
  });
});
