import { describe, expect, it } from "vitest";

import { dueFor, mergeRules } from "@/lib/client-reminders";
import {
  collectionsKey,
  invoiceDueAt,
  invoiceReminderMessage,
  invoiceSettled,
  invoiceTakesReminders,
  needsCollections,
  type InvoiceFacts,
} from "@/lib/client-automations/invoices";

const invoice = (over: Partial<InvoiceFacts> = {}): InvoiceFacts => ({
  id: "inv1",
  status: "open",
  amount: 1850,
  sentAt: "2026-10-01T14:00:00Z",
  createdAt: "2026-10-01T13:00:00Z",
  paidAt: null,
  hostedInvoiceUrl: "https://invoice.stripe.com/i/abc",
  payBy: null,
  ...over,
});

describe("invoice due dates", () => {
  it("is due 30 days after it was sent, the terms Stripe was given", () => {
    expect(invoiceDueAt(invoice()).toISOString()).toBe("2026-10-31T14:00:00.000Z");
    expect(invoiceDueAt(invoice({ sentAt: null })).toISOString()).toBe("2026-10-31T13:00:00.000Z");
  });

  it("is settled once paid, voided or empty", () => {
    expect(invoiceSettled(invoice())).toBe(false);
    expect(invoiceSettled(invoice({ status: "paid" }))).toBe(true);
    expect(invoiceSettled(invoice({ status: "void" }))).toBe(true);
    expect(invoiceSettled(invoice({ paidAt: "2026-10-20T00:00:00Z" }))).toBe(true);
    expect(invoiceSettled(invoice({ amount: 0 }))).toBe(true);
  });

  it("doesn't text somebody who is paying cash to a person", () => {
    expect(invoiceTakesReminders(invoice())).toBe(true);
    expect(invoiceTakesReminders(invoice({ payBy: "cash" }))).toBe(false);
  });
});

describe("the reminder timing", () => {
  const rules = mergeRules([]);
  const subject = (now: string) => ({
    subject: { kind: "invoice_reminder" as const, referenceId: "inv1", customerId: "c1", anchor: invoiceDueAt(invoice()), settled: false },
    now: new Date(now),
  });

  it("nudges 3 days before, on the day, then 7 and 21 days late", () => {
    const at = (iso: string) => dueFor(subject(iso).subject, rules, new Date(iso)).map((d) => `${d.offsetHours}:${d.channel}`);
    expect(at("2026-10-28T15:00:00Z")).toEqual(["-72:email", "-72:sms"]);
    expect(at("2026-10-31T15:00:00Z")).toEqual(["0:email", "0:sms"]);
    expect(at("2026-11-07T15:00:00Z")).toEqual(["168:email", "168:sms"]);
    expect(at("2026-11-21T15:00:00Z")).toEqual(["504:email", "504:sms"]);
    expect(at("2026-11-14T15:00:00Z")).toEqual([]);
  });

  it("stops the moment it is paid", () => {
    const s = { ...subject("2026-10-31T15:00:00Z").subject, settled: true };
    expect(dueFor(s, rules, new Date("2026-10-31T15:00:00Z"))).toEqual([]);
  });
});

describe("collections", () => {
  it("hands the invoice to a person once it runs past the last reminder", () => {
    expect(needsCollections(invoice(), new Date("2026-11-27T15:00:00Z"), 28)).toBe(false);
    expect(needsCollections(invoice(), new Date("2026-11-28T15:00:00Z"), 28)).toBe(true);
    expect(needsCollections(invoice({ status: "paid" }), new Date("2026-12-28T15:00:00Z"), 28)).toBe(false);
    expect(collectionsKey("inv1")).toBe("collections:inv1");
  });
});

describe("the wording", () => {
  const base = {
    channel: "sms" as const,
    businessName: "JS Landscaping",
    clientName: "Deanna Smith",
    amount: 1850,
    dueAt: new Date("2026-10-31T14:00:00Z"),
    timeZone: "America/New_York",
    payLink: "https://invoice.stripe.com/i/abc",
  };

  it("says where it falls and always carries the pay link", () => {
    const before = invoiceReminderMessage({ ...base, offsetHours: -72 });
    expect(before.body).toContain("is due Saturday, October 31");
    expect(before.body).toContain("https://invoice.stripe.com/i/abc");
    expect(invoiceReminderMessage({ ...base, offsetHours: 0 }).body).toContain("due today");
    expect(invoiceReminderMessage({ ...base, offsetHours: 168 }).body).toContain("still open");
    expect(invoiceReminderMessage({ ...base, offsetHours: 504, channel: "email" }).subject).toBe("Second notice: $1,850 still open");
  });

  it("offers to send a link when there isn't one, and adds the opt-out when asked", () => {
    const msg = invoiceReminderMessage({ ...base, offsetHours: 0, payLink: null, includeOptOut: true });
    expect(msg.body).toContain("Reply and we will send you a link");
    expect(msg.body.endsWith("Reply STOP to stop.")).toBe(true);
  });
});
