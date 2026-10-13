import { describe, expect, it } from "vitest";

import { invoicesDue, isMine, later, leadReason, leadsToBook, outstandingFor, waitingMessages, type DueInvoice, type LeadJob } from "@/lib/am-home";

const NOW = new Date("2026-10-13T15:00:00Z");
const ME = "me";

const lead = (over: Partial<LeadJob>): LeadJob => ({
  jobId: "j",
  customerName: "Jane",
  phone: "4105550100",
  address: "1 Main St",
  managerId: null,
  doNotContact: false,
  createdAt: "2026-10-12T15:00:00Z",
  evaluationDate: null,
  evaluationStatus: null,
  ...over,
});

describe("whose clients", () => {
  it("is mine when I manage it or nobody does", () => {
    expect(isMine(ME, ME)).toBe(true);
    expect(isMine(null, ME)).toBe(true);
    expect(isMine("someone-else", ME)).toBe(false);
  });
});

describe("leads to book", () => {
  it("knows why a lead needs a visit", () => {
    expect(leadReason({ evaluationDate: null, evaluationStatus: null }, NOW)).toBe("new");
    expect(leadReason({ evaluationDate: "2026-10-10T14:00:00Z", evaluationStatus: "cancelled" }, NOW)).toBe("rebook");
    expect(leadReason({ evaluationDate: "2026-10-10T14:00:00Z", evaluationStatus: "scheduled" }, NOW)).toBe("missed");
    // Booked and still to come, or only just passed: nothing to do.
    expect(leadReason({ evaluationDate: "2026-10-20T14:00:00Z", evaluationStatus: "scheduled" }, NOW)).toBeNull();
    expect(leadReason({ evaluationDate: "2026-10-13T09:00:00Z", evaluationStatus: "scheduled" }, NOW)).toBeNull();
    expect(leadReason({ evaluationDate: "2026-10-10T14:00:00Z", evaluationStatus: "completed" }, NOW)).toBeNull();
  });

  it("puts the newest new lead first, then rebooks, then missed visits", () => {
    const list = leadsToBook(
      [
        lead({ jobId: "missed", evaluationDate: "2026-10-01T14:00:00Z", evaluationStatus: "scheduled" }),
        lead({ jobId: "old-new", createdAt: "2026-10-01T10:00:00Z" }),
        lead({ jobId: "rebook", evaluationDate: "2026-10-11T14:00:00Z", evaluationStatus: "cancelled" }),
        lead({ jobId: "new-new", createdAt: "2026-10-13T10:00:00Z" }),
      ],
      ME,
      NOW
    );
    expect(list.map((l) => l.jobId)).toEqual(["new-new", "old-new", "rebook", "missed"]);
    expect(list[0].why).toBe("New lead, came in today");
    expect(list[1].why).toBe("New lead, came in 12 days ago");
  });

  it("leaves off other people's clients and anybody marked do not contact", () => {
    const list = leadsToBook([lead({ jobId: "theirs", managerId: "other" }), lead({ jobId: "dnc", doNotContact: true }), lead({ jobId: "mine", managerId: ME })], ME, NOW);
    expect(list.map((l) => l.jobId)).toEqual(["mine"]);
  });
});

describe("client messages waiting", () => {
  it("keeps the newest unanswered message per job, longest wait first", () => {
    const waiting = waitingMessages(
      [
        { jobId: "a", body: "first", authorName: "A", createdAt: "2026-10-12T10:00:00Z" },
        { jobId: "a", body: "second", authorName: "A", createdAt: "2026-10-13T10:00:00Z" },
        { jobId: "b", body: "hello", authorName: "B", createdAt: "2026-10-11T10:00:00Z" },
        { jobId: "c", body: "answered", authorName: "C", createdAt: "2026-10-11T10:00:00Z" },
      ],
      new Map([
        ["a", "2026-10-12T12:00:00Z"],
        ["c", "2026-10-11T11:00:00Z"],
      ])
    );
    expect(waiting.map((m) => `${m.jobId}:${m.body}`)).toEqual(["b:hello", "a:second"]);
  });

  it("takes the later of a reply and a mark-read", () => {
    expect(later(null, "2026-01-01")).toBe("2026-01-01");
    expect(later("2026-02-01", "2026-01-01")).toBe("2026-02-01");
    expect(later(undefined, undefined)).toBeNull();
  });
});

describe("invoices due", () => {
  const inv = (over: Partial<DueInvoice>): DueInvoice => ({
    invoiceId: "i",
    jobId: "j",
    customerName: "Jane",
    managerId: ME,
    amount: 100,
    sentAt: "2026-10-01T10:00:00Z",
    createdAt: "2026-10-01T10:00:00Z",
    payBy: null,
    ...over,
  });

  it("puts cash or check waiting first, then the oldest", () => {
    const list = invoicesDue(
      [inv({ invoiceId: "newer", sentAt: "2026-10-10T10:00:00Z" }), inv({ invoiceId: "older", sentAt: "2026-09-01T10:00:00Z" }), inv({ invoiceId: "check", payBy: "check", sentAt: "2026-10-12T10:00:00Z" }), inv({ invoiceId: "theirs", managerId: "other" })],
      ME
    );
    expect(list.map((i) => i.invoiceId)).toEqual(["check", "older", "newer"]);
  });

  it("says how long it has been out", () => {
    expect(outstandingFor({ sentAt: "2026-10-13T10:00:00Z", createdAt: "2026-10-13T10:00:00Z" }, NOW)).toBe("sent today");
    expect(outstandingFor({ sentAt: "2026-10-12T10:00:00Z", createdAt: "2026-10-12T10:00:00Z" }, NOW)).toBe("out 1 day");
    expect(outstandingFor({ sentAt: null, createdAt: "2026-10-03T10:00:00Z" }, NOW)).toBe("out 10 days");
  });
});
