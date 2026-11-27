import { describe, expect, it } from "vitest";

import { nextStep, withoutEmptyCopies } from "@/lib/client-next-step";
import type { FileJob } from "@/lib/data/client-file";

const job = (over: Partial<FileJob>): FileJob => ({
  id: "j",
  name: "Job",
  status: "estimating",
  address: "423 Silverside Road, Edgewood, Maryland 21040",
  evaluationDate: null,
  evaluationStatus: null,
  startDate: null,
  endDate: null,
  completedAt: null,
  proposal: null,
  estimate: null,
  invoices: [],
  messages: [],
  ...over,
});
const now = new Date("2026-11-27T12:00:00Z");

describe("nextStep", () => {
  it("asks to price a visited job with nothing priced", () => {
    expect(nextStep(job({ evaluationDate: "2026-11-23T18:00:00Z" }), now).kind).toBe("price");
  });
  it("sends a priced, unsent estimate", () => {
    expect(nextStep(job({ estimate: { token: "t", total: 900, deposit: 300, paidAt: null, choice: null } }), now).kind).toBe("send_estimate");
  });
  it("sends an approved proposal that hasn't gone out", () => {
    const proposal = { token: "p", status: "sent", total: 900, sentAt: null, respondedAt: null, addons: [] };
    expect(nextStep(job({ proposal }), now)).toEqual({ kind: "send_proposal", label: "Send the proposal" });
  });
  it("waits once the proposal is out", () => {
    const proposal = { token: "p", status: "sent", total: 900, sentAt: "2026-11-25T12:00:00Z", respondedAt: null, addons: [] };
    expect(nextStep(job({ proposal }), now).kind).toBe("await_answer");
  });
  it("approves a draft first", () => {
    const proposal = { token: "p", status: "needs_approval", total: 900, sentAt: null, respondedAt: null, addons: [] };
    expect(nextStep(job({ proposal }), now).kind).toBe("approve_proposal");
  });
});

describe("withoutEmptyCopies", () => {
  // Gertrude's page: the booked visit plus three empty estimate jobs made by pressing New estimate again.
  const real = job({ id: "real", address: "423 Silverside Road, Edgewood, Maryland 21040, United States", evaluationDate: "2026-11-23T18:00:00Z" });
  const copies = [job({ id: "c3" }), job({ id: "c2" }), job({ id: "c1" })];

  it("shows the real job once", () => {
    expect(withoutEmptyCopies([...copies, real]).map((j) => j.id)).toEqual(["real"]);
  });
  it("keeps the newest of several empty ones", () => {
    expect(withoutEmptyCopies(copies).map((j) => j.id)).toEqual(["c3"]);
  });
  it("never hides the job the page was opened on", () => {
    expect(withoutEmptyCopies([...copies, real], "c2").map((j) => j.id)).toEqual(["c2", "real"]);
  });
  it("leaves a job at another house alone", () => {
    const other = job({ id: "o", address: "12 Main St, Bel Air, MD 21014" });
    expect(withoutEmptyCopies([other, real]).map((j) => j.id)).toEqual(["o", "real"]);
  });
});
