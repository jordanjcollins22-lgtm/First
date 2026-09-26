import { describe, expect, it } from "vitest";

import { loginUrlFor, safeReturnTo } from "./return-to";

describe("safeReturnTo", () => {
  it("keeps a path on this site, query and hash included", () => {
    expect(safeReturnTo("/my-day")).toBe("/my-day");
    expect(safeReturnTo("/my-day#approvals")).toBe("/my-day#approvals");
    expect(safeReturnTo("/jobs/abc?tab=money")).toBe("/jobs/abc?tab=money");
  });

  it("sends anything that could leave the site to the front door", () => {
    expect(safeReturnTo("https://evil.example/my-day")).toBe("/");
    expect(safeReturnTo("//evil.example")).toBe("/");
    expect(safeReturnTo("/\\evil.example")).toBe("/");
    expect(safeReturnTo("javascript:alert(1)")).toBe("/");
    expect(safeReturnTo("")).toBe("/");
    expect(safeReturnTo(null)).toBe("/");
  });

  it("never loops back to the sign-in page", () => {
    expect(safeReturnTo("/login")).toBe("/");
    expect(safeReturnTo("/login?code=1")).toBe("/");
    expect(safeReturnTo("/logins")).toBe("/logins");
  });
});

describe("loginUrlFor", () => {
  it("remembers where they were going", () => {
    expect(loginUrlFor("/my-day", "")).toBe("/login?next=%2Fmy-day");
    expect(loginUrlFor("/jobs/abc", "?tab=money")).toBe("/login?next=%2Fjobs%2Fabc%3Ftab%3Dmoney");
  });
  it("is plain for the front door and for the sign-in page itself", () => {
    expect(loginUrlFor("/", "")).toBe("/login");
    expect(loginUrlFor("/login", "?code=1")).toBe("/login");
  });
});
