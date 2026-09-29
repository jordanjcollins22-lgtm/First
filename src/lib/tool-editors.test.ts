import { describe, expect, it } from "vitest";

import { canEditTools, isToolsOwner } from "./tool-editors";

describe("who changes tools and kits", () => {
  it("is the owner, by either of his sign-ins", () => {
    expect(isToolsOwner("Jordan@JSLandscapingMD.com")).toBe(true);
    expect(isToolsOwner("jordanjcollins22@gmail.com")).toBe(true);
    expect(canEditTools({ email: "jordan@jslandscapingmd.com" })).toBe(true);
  });

  it("is nobody else, admin or not, unless the owner allowed them", () => {
    expect(canEditTools({ email: "sageheff7@gmail.com", can_edit_tools: false })).toBe(false);
    expect(canEditTools({ email: "kingjoffyjugg@gmail.com" })).toBe(false);
    expect(canEditTools({ email: "kingjoffyjugg@gmail.com", can_edit_tools: true })).toBe(true);
    expect(canEditTools(null)).toBe(false);
  });
});
