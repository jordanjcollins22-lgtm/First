import { describe, expect, it } from "vitest";

import {
  ALERT_KEYS,
  alertLine,
  backOfficeRef,
  day,
  dollarsToCents,
  invoiceActionIds,
  isAlertKey,
  isIsoDate,
  jobIdFromHref,
  roleChange,
  splitRef,
  splitResolution,
  usd,
  usdExact,
  words,
} from "@/lib/entities/handlers/admin-format";

describe("money and dates", () => {
  it("rounds dollars and shows a dash for nothing", () => {
    expect(usd(1234.4)).toBe("$1,234");
    expect(usd(-50)).toBe("-$50");
    expect(usd(null)).toBe("—");
    expect(usdExact(1200.5)).toBe("$1,200.50");
  });

  it("reads a bare date as that calendar day", () => {
    expect(day("2026-03-04")).toBe("Mar 4, 2026");
    expect(day(null)).toBe("—");
    expect(day("not a date")).toBe("—");
  });

  it("turns typed dollars into cents", () => {
    expect(dollarsToCents("$1,200.50")).toBe(120050);
    expect(dollarsToCents("0")).toBeNull();
    expect(dollarsToCents("")).toBeNull();
  });

  it("checks a date", () => {
    expect(isIsoDate("2026-10-13")).toBe(true);
    expect(isIsoDate("10/13/2026")).toBe(false);
    expect(isIsoDate(undefined)).toBe(false);
  });

  it("makes words of snake case", () => {
    expect(words("needs_approval")).toBe("Needs approval");
    expect(words("")).toBe("—");
  });
});

describe("refs", () => {
  it("splits a composite id at the first colon only", () => {
    expect(splitRef("price:abc")).toEqual(["price", "abc"]);
    expect(splitRef("back_office:compliance:x:2026-01-01:soon")).toEqual(["back_office", "compliance:x:2026-01-01:soon"]);
    expect(splitRef("plain")).toEqual(["plain", ""]);
  });

  it("finds the job in an old-app link", () => {
    expect(jobIdFromHref("/jobs/0b5c2a1e-1111-2222-3333-444455556666")).toBe("0b5c2a1e-1111-2222-3333-444455556666");
    expect(jobIdFromHref("/my-day#approvals")).toBeNull();
    expect(jobIdFromHref(null)).toBeNull();
  });

  it("points each back-office key at what it names", () => {
    expect(backOfficeRef("commission_batch:b1")).toEqual({ kind: "admin.commission_batch", id: "b1" });
    expect(backOfficeRef("compliance:o1:2026-01-01:overdue")).toEqual({ kind: "admin.obligation", id: "o1" });
    expect(backOfficeRef("onboarding:i1:overdue")).toEqual({ kind: "admin.onboarding_item", id: "i1" });
    expect(backOfficeRef("role:p1:unmapped")).toEqual({ kind: "admin.profile", id: "p1" });
    expect(backOfficeRef("affiliate_rate:p2")).toEqual({ kind: "admin.profile", id: "p2" });
    expect(backOfficeRef("something_else:x")).toBeNull();
    expect(backOfficeRef("compliance:")).toBeNull();
  });
});

describe("alerts", () => {
  it("knows its keys", () => {
    expect(ALERT_KEYS.every(isAlertKey)).toBe(true);
    expect(isAlertKey("nope")).toBe(false);
  });

  it("says nothing for an empty alert and counts the rest", () => {
    expect(alertLine("open_issues", 0)).toBe("");
    expect(alertLine("open_issues", 3)).toBe("3 open job issues");
    expect(alertLine("approvals", 2, 4500)).toBe("2 proposals need your approval ($4,500)");
  });
});

describe("invoice actions", () => {
  it("offers resend, cash, check and void on an open Stripe invoice with a link", () => {
    expect(invoiceActionIds({ source: "stripe", status: "open", hasLink: true })).toEqual(["resend_sms", "resend_email", "paid_cash", "paid_check", "void"]);
  });

  it("offers no resend without a link, and nothing once paid or void", () => {
    expect(invoiceActionIds({ source: "stripe", status: "open", hasLink: false })).toEqual(["paid_cash", "paid_check", "void"]);
    expect(invoiceActionIds({ source: "stripe", status: "paid", hasLink: true })).toEqual([]);
    expect(invoiceActionIds({ source: "stripe", status: "void", hasLink: true })).toEqual([]);
  });

  it("lets an uploaded invoice be marked paid, unpaid again, or deleted", () => {
    expect(invoiceActionIds({ source: "upload", status: "open", hasLink: false })).toEqual(["paid_cash", "paid_check", "delete"]);
    expect(invoiceActionIds({ source: "upload", status: "paid", hasLink: false })).toEqual(["unpaid", "delete"]);
  });
});

describe("roleChange", () => {
  it("adds the new role and takes away every other", () => {
    expect(roleChange(["crew", "foreman"], "account-manager")).toEqual({ add: ["account manager"], remove: ["crew", "foreman"] });
  });

  it("adds nothing when the role is already held", () => {
    expect(roleChange(["Account_Manager", "crew"], "account-manager")).toEqual({ add: [], remove: ["crew"] });
  });

  it("keeps both owner-level names", () => {
    expect(roleChange(["admin", "evaluator"], "owner")).toEqual({ add: ["owner"], remove: ["evaluator"] });
  });

  it("does nothing to somebody who already holds just that role", () => {
    expect(roleChange(["evaluator"], "evaluator")).toEqual({ add: [], remove: [] });
  });
});

describe("splitResolution", () => {
  it("takes the first line as what was done and the rest as prevention", () => {
    expect(splitResolution("\nReplaced the stone.\nCheck the delivery ticket on arrival.\nAnd photograph it.")).toEqual({
      resolution: "Replaced the stone.",
      prevention: "Check the delivery ticket on arrival.\nAnd photograph it.",
    });
  });

  it("leaves prevention empty when there is one line", () => {
    expect(splitResolution("Fixed")).toEqual({ resolution: "Fixed", prevention: "" });
    expect(splitResolution("")).toEqual({ resolution: "", prevention: "" });
  });
});
