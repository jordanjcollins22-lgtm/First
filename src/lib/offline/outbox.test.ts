import { describe, expect, it } from "vitest";

import { isNoSignal } from "./outbox";

describe("isNoSignal", () => {
  it("knows each browser's way of saying the request never got out", () => {
    expect(isNoSignal(new TypeError("Failed to fetch"))).toBe(true); // Chrome
    expect(isNoSignal(new TypeError("Load failed"))).toBe(true); // Safari
    expect(isNoSignal(new TypeError("NetworkError when attempting to fetch resource."))).toBe(true); // Firefox
    expect(isNoSignal({ message: "The Internet connection appears to be offline." })).toBe(true);
  });

  it("doesn't mistake a refusal for no signal", () => {
    expect(isNoSignal(new Error("That link has expired or was never ours."))).toBe(false);
    expect(isNoSignal({ message: "new row violates row-level security policy" })).toBe(false);
    expect(isNoSignal(null)).toBe(false);
  });
});
