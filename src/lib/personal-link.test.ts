import { describe, expect, it } from "vitest";

import { dashboardPath, roleHomePath, slugBase } from "@/lib/personal-link";

describe("personal links", () => {
  it("puts the person's slug in the path", () => {
    expect(dashboardPath("jace-7k2m")).toBe("/p/jace-7k2m");
  });

  it("sends each role to its own page", () => {
    expect(roleHomePath(["owner"])).toBe("/v2/admin?choice=oversight");
    expect(roleHomePath(["account-manager", "affiliate"])).toBe("/v2/sales?choice=pipeline");
    expect(roleHomePath(["project-technician", "affiliate"])).toBe("/v2/operations?choice=projects");
    expect(roleHomePath(["affiliate"])).toBe("/v2/marketing?choice=digital");
    expect(roleHomePath([])).toBe("/");
  });

  it("names a slug after their first name", () => {
    expect(slugBase({ full_name: "Jackson Truhlar" })).toBe("jackson");
    expect(slugBase({ full_name: null, email: "travis@jslandscapingmd.com" })).toBe("travis");
    expect(slugBase({ full_name: "  ", email: "" })).toBe("me");
  });
});
