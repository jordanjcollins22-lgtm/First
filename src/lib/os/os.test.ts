import { describe, expect, it } from "vitest";

import { CONSUMERS, eventKey, validateEvent, type EventInput, type EventType } from "@/lib/os/contracts";
import { MemoryStore } from "@/lib/os/memory-store";
import { canMove, STAGE, stageOf } from "@/lib/os/stage";
import { retryDelayMs } from "@/lib/os/rules";
import type { ContactFacts, OsFacts, ProposalFacts } from "@/lib/os/store";
import { runWorker } from "@/lib/os/worker";
import type { Deps } from "@/lib/os/handlers";
import type { JobFacts } from "@/lib/readiness";
import type { Issue } from "@/lib/issues";

const ORG = "11111111-1111-4111-8111-111111111111";
const JOB = "22222222-2222-4222-8222-222222222222";
const PROPOSAL = "33333333-3333-4333-8333-333333333333";
const NEWER_PROPOSAL = "33333333-3333-4333-8333-444444444444";
const CUSTOMER = "55555555-5555-4555-8555-555555555555";
const T0 = Date.parse("2026-10-21T13:00:00.000Z");
const HOUR = 60 * 60 * 1000;

function readyFacts(over: Partial<JobFacts> = {}): JobFacts {
  return {
    status: "approved",
    servicesDefined: true,
    servicesSource: "test",
    proposalAccepted: true,
    proposalSource: "test",
    measurementRequired: false,
    measurementsPresent: true,
    scheduled: false,
    crewAssigned: false,
    workOrderReady: false,
    workOrderSource: "test",
    materials: "confirmed",
    materialsSource: "test",
    equipment: "confirmed",
    equipmentSource: "test",
    access: "confirmed",
    accessSource: "test",
    depositRequiredCents: 0,
    depositReceivedCents: 0,
    depositSource: "test",
    evaluationPhotos: 1,
    preworkPhotos: 0,
    afterPhotos: 0,
    walkthroughDone: false,
    invoiceRaised: false,
    balanceOutstanding: null,
    financialDisposition: null,
    ...over,
  };
}

class FakeFacts implements OsFacts {
  proposals = new Map<string, ProposalFacts>();
  jobFacts: JobFacts = readyFacts();
  issues: Issue[] = [];
  lastContact: Date | null = null;
  contactFacts: ContactFacts | null = { doNotContact: false, smsConsent: "unknown", emailConsent: "unknown", phone: "+14105550100", email: "c@example.com" };
  logged = new Map<string, "sent" | "skipped" | "failed">();
  failSchedulingFacts = 0;

  async proposal(id: string) {
    return this.proposals.get(id) ?? null;
  }
  async schedulingFacts() {
    if (this.failSchedulingFacts > 0) {
      this.failSchedulingFacts -= 1;
      throw new Error("database timed out");
    }
    return { facts: this.jobFacts, issues: this.issues, overrides: [] };
  }
  async lastClientContact() {
    return this.lastContact;
  }
  async contact() {
    return this.contactFacts;
  }
  providerReady() {
    return { sms: true, email: true };
  }
  async existingSend(_org: string, key: string) {
    return this.logged.get(key) ?? null;
  }
}

function setup(opts: { dryRun?: boolean; paused?: boolean } = {}) {
  const store = new MemoryStore();
  let clock = T0;
  store.now = () => clock;
  store.controlsByOrg.set(ORG, { eventsEnabled: true, dryRun: opts.dryRun ?? true, paused: opts.paused ?? false });
  const facts = new FakeFacts();
  facts.proposals.set(PROPOSAL, {
    id: PROPOSAL,
    jobId: JOB,
    organizationId: ORG,
    status: "accepted",
    sentAt: new Date(T0 - 24 * HOUR).toISOString(),
    expiresAt: null,
    customerId: CUSTOMER,
    latestProposalIdForJob: PROPOSAL,
  });
  const deps: Deps = { store, facts, now: () => new Date(clock) };
  const advance = (ms: number) => {
    clock += ms;
  };
  const emit = <T extends EventType>(type: T, payload: EventInput<T>["payload"], key: string, entityId = JOB, occurredAt = new Date(clock).toISOString()) =>
    store.recordEvent(
      { organizationId: ORG, type, entityId, occurredAt, actor: { type: "customer", id: null }, source: "test", idempotencyKey: key, payload } as EventInput,
      CONSUMERS[type]
    );
  return { store, facts, deps, advance, emit };
}

const approve = (emit: ReturnType<typeof setup>["emit"], proposalId = PROPOSAL) =>
  emit("estimate.approved", { jobId: JOB, proposalId, customerId: CUSTOMER, acceptedTotalCents: 450000 }, eventKey.estimateApproved(proposalId), proposalId);

describe("event contracts", () => {
  it("accepts a well-formed event and names every problem in a bad one", () => {
    const good: EventInput = {
      organizationId: ORG,
      type: "estimate.approved",
      entityId: PROPOSAL,
      occurredAt: new Date(T0).toISOString(),
      actor: { type: "customer", id: null },
      source: "proposal_page",
      idempotencyKey: eventKey.estimateApproved(PROPOSAL),
      payload: { jobId: JOB, proposalId: PROPOSAL, customerId: CUSTOMER, acceptedTotalCents: 450000 },
    };
    expect(validateEvent(good)).toEqual({ ok: true });

    const bad = validateEvent({ ...good, occurredAt: "yesterday", payload: { jobId: JOB, proposalId: PROPOSAL, customerId: CUSTOMER, acceptedTotalCents: 4500.5 } } as EventInput);
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.problems).toEqual(["occurredAt is not an ISO instant", "payload.acceptedTotalCents is not valid"]);
  });

  it("treats missing payload fields as missing, never as zero", () => {
    const v = validateEvent({
      organizationId: ORG,
      type: "deposit.settled",
      entityId: JOB,
      occurredAt: new Date(T0).toISOString(),
      actor: { type: "integration", id: "stripe" },
      source: "stripe_webhook",
      idempotencyKey: "k",
      payload: { jobId: JOB, proposalId: null, paymentRef: "pi_1" },
    } as unknown as EventInput);
    expect(v).toEqual({ ok: false, problems: ["payload.amountCents is missing"] });
  });
});

describe("stage codes", () => {
  it("maps the app's statuses to the spec's codes", () => {
    expect(stageOf({ status: "estimating", evaluationStatus: "scheduled", evaluationDate: null, paidInFull: false })).toBe(STAGE.NEW_LEAD);
    expect(stageOf({ status: "estimating", evaluationStatus: "scheduled", evaluationDate: "2026-10-23", paidInFull: false })).toBe(STAGE.APPOINTMENT_SCHEDULED);
    expect(stageOf({ status: "estimating", evaluationStatus: "completed", evaluationDate: "2026-10-20", paidInFull: false })).toBe(STAGE.ESTIMATE_PREPARATION);
    expect(stageOf({ status: "approved", evaluationStatus: "completed", evaluationDate: null, paidInFull: false })).toBe(STAGE.APPROVED_AWAITING_SCHEDULING);
    expect(stageOf({ status: "completed", evaluationStatus: "completed", evaluationDate: null, paidInFull: false })).toBe(STAGE.AWAITING_PAYMENT);
    expect(stageOf({ status: "completed", evaluationStatus: "completed", evaluationDate: null, paidInFull: true })).toBe(STAGE.CLOSED);
  });

  it("allows real moves and refuses regressions the business never makes", () => {
    expect(canMove(STAGE.NEW_LEAD, STAGE.ESTIMATE_PREPARATION)).toBe(true);
    expect(canMove(STAGE.APPROVED_AWAITING_SCHEDULING, STAGE.ESTIMATE_PREPARATION)).toBe(true);
    expect(canMove(STAGE.APPROVED_AWAITING_SCHEDULING, STAGE.NEW_LEAD)).toBe(false);
    expect(canMove(STAGE.CLOSED, STAGE.CANCELED)).toBe(false);
    expect(canMove(STAGE.CANCELED, STAGE.JOB_IN_PROGRESS)).toBe(false);
  });
});

describe("lead to appointment", () => {
  it("opens a booking task for a new lead, and closes it when a visit is booked", async () => {
    const { store, deps, emit } = setup();
    await emit("lead.created", { jobId: JOB, customerId: CUSTOMER, propertyId: null, channel: "booking_page", evaluationAt: null }, eventKey.leadCreated(JOB));
    await runWorker(deps);
    expect(store.tasks.map((t) => [t.kind, t.state])).toEqual([["book_evaluation", "open"]]);

    const startsAt = new Date(T0 + 48 * HOUR).toISOString();
    await emit("appointment.requested", { jobId: JOB, startsAt, evaluatorId: null }, eventKey.appointmentRequested(JOB, startsAt));
    await runWorker(deps);
    expect(store.tasks.map((t) => [t.kind, t.state])).toEqual([
      ["book_evaluation", "done"],
      ["confirm_appointment", "open"],
    ]);

    await emit("appointment.confirmed", { jobId: JOB, startsAt, confirmedBy: "client" }, eventKey.appointmentConfirmed(JOB, startsAt));
    await runWorker(deps);
    expect(store.tasks.find((t) => t.kind === "confirm_appointment")?.state).toBe("done");
  });

  it("does not let a late, out-of-order request undo a confirmation", async () => {
    const { store, deps, emit } = setup();
    const startsAt = new Date(T0 + 48 * HOUR).toISOString();
    await emit("appointment.confirmed", { jobId: JOB, startsAt, confirmedBy: "client" }, eventKey.appointmentConfirmed(JOB, startsAt), JOB, new Date(T0).toISOString());
    // The request happened first but its webhook arrived second.
    await emit("appointment.requested", { jobId: JOB, startsAt, evaluatorId: null }, eventKey.appointmentRequested(JOB, startsAt), JOB, new Date(T0 - HOUR).toISOString());
    await runWorker(deps);
    expect(store.tasks.filter((t) => t.kind === "confirm_appointment" && t.state === "open")).toHaveLength(0);
    expect(store.audits.some((a) => a.decision === "ignored_out_of_order")).toBe(true);
  });

  it("escalates an estimate not sent by its deadline, once", async () => {
    const { store, deps, emit, advance } = setup();
    await emit("appointment.completed", { jobId: JOB, completedAt: new Date(T0).toISOString() }, eventKey.appointmentCompleted(JOB));
    await runWorker(deps);
    advance(49 * HOUR);
    await runWorker(deps);
    await runWorker(deps);
    const task = store.tasks.find((t) => t.kind === "prepare_estimate");
    expect(task?.escalatedAt).not.toBeNull();
    expect(store.audits.filter((a) => a.decision === "estimate_late_escalated")).toHaveLength(1);
  });
});

describe("estimate.approved", () => {
  it("does not duplicate tasks, deposit requests or readiness when the approval is replayed", async () => {
    const { store, deps, emit, facts } = setup();
    facts.jobFacts = readyFacts({ depositRequiredCents: 150000, depositReceivedCents: 0 });
    await approve(emit);
    await approve(emit);
    await runWorker(deps);
    // Redelivered after a crash: the outbox row comes back.
    for (const d of store.deliveries) d.status = "pending";
    await runWorker(deps);

    expect(store.events.filter((e) => e.type === "estimate.approved")).toHaveLength(1);
    expect(store.actions.filter((a) => a.actionType === "await_deposit")).toHaveLength(1);
    expect(store.events.filter((e) => e.type === "deposit.requested")).toHaveLength(1);
    expect(store.tasks.filter((t) => t.kind === "collect_deposit")).toHaveLength(1);
  });

  it("waits for settled money, then makes the job ready exactly once", async () => {
    const { store, deps, emit, facts } = setup();
    facts.jobFacts = readyFacts({ depositRequiredCents: 150000, depositReceivedCents: 0 });
    await approve(emit);
    await runWorker(deps);
    expect(store.events.some((e) => e.type === "job.ready_for_scheduling")).toBe(false);

    facts.jobFacts = readyFacts({ depositRequiredCents: 150000, depositReceivedCents: 150000 });
    for (const ref of ["pi_1", "pi_1"]) {
      await emit("deposit.settled", { jobId: JOB, proposalId: PROPOSAL, amountCents: 150000, paymentRef: ref }, eventKey.depositSettled(ref));
    }
    await runWorker(deps);

    expect(store.events.filter((e) => e.type === "job.ready_for_scheduling")).toHaveLength(1);
    expect(store.actions.find((a) => a.actionType === "await_deposit")?.observedStatus).toBe("settled");
    expect(store.tasks.find((t) => t.kind === "collect_deposit")?.state).toBe("done");
    expect(store.tasks.filter((t) => t.kind === "schedule_job" && t.state === "open")).toHaveLength(1);
  });

  it("chains every follow-on fact to the approval", async () => {
    const { store, deps, emit } = setup();
    const { eventId } = await approve(emit);
    await runWorker(deps);
    const ready = store.events.find((e) => e.type === "job.ready_for_scheduling");
    expect(ready?.causationId).toBe(eventId);
    expect(ready?.correlationId).toBe(eventId);
  });

  it("holds an approval for an older proposal version", async () => {
    const { store, deps, emit, facts } = setup();
    facts.proposals.set(PROPOSAL, { ...facts.proposals.get(PROPOSAL)!, latestProposalIdForJob: NEWER_PROPOSAL });
    await approve(emit);
    await runWorker(deps);
    expect(store.tasks.map((t) => t.kind)).toEqual(["review_approval"]);
    expect(store.events.some((e) => e.type === "job.ready_for_scheduling")).toBe(false);
  });

  it("blocks readiness on unconfirmed materials, then clears it when they are confirmed", async () => {
    const { store, deps, emit, facts } = setup();
    facts.jobFacts = readyFacts({ materials: "required_unconfirmed" });
    await approve(emit);
    await runWorker(deps);
    expect(store.tasks.filter((t) => t.state === "open").map((t) => t.kind)).toEqual(["readiness:materials"]);
    expect(store.events.some((e) => e.type === "job.ready_for_scheduling")).toBe(false);

    facts.jobFacts = readyFacts({ materials: "confirmed" });
    await runWorker(deps);
    expect(store.tasks.find((t) => t.kind === "readiness:materials")?.state).toBe("done");
    expect(store.events.filter((e) => e.type === "job.ready_for_scheduling")).toHaveLength(1);
  });

  it("is not made ready while a blocking issue is open, whatever else passes", async () => {
    const { store, deps, emit, facts } = setup();
    facts.issues = [{ id: "i1", jobId: JOB, severity: "blocking", status: "open", blocking: true, blockingStage: "ready" } as Issue];
    await approve(emit);
    await runWorker(deps);
    expect(store.events.some((e) => e.type === "job.ready_for_scheduling")).toBe(false);
    expect(store.audits.find((a) => a.decision === "not_ready")?.inputs).toMatchObject({ blockingIssues: ["i1"] });
  });
});

describe("proposal_followup_v1", () => {
  async function sent(ctx: ReturnType<typeof setup>) {
    const sentAt = new Date(T0).toISOString();
    ctx.facts.proposals.set(PROPOSAL, { ...ctx.facts.proposals.get(PROPOSAL)!, status: "sent", sentAt });
    await ctx.emit("estimate.sent", { jobId: JOB, proposalId: PROPOSAL, customerId: CUSTOMER, sentAt, totalCents: 450000 }, eventKey.estimateSent(PROPOSAL, sentAt), PROPOSAL);
    await runWorker(ctx.deps);
  }

  it("schedules one action per touch, keyed by proposal, version and step", async () => {
    const ctx = setup();
    await sent(ctx);
    await sent(ctx);
    expect(ctx.store.actions.map((a) => a.dueAt)).toEqual([3, 7, 14, 21, 30].map((d) => new Date(T0 + d * 24 * HOUR).toISOString()));
  });

  it("proposes the day-3 touch in dry run, and notes what the live sequence did", async () => {
    const ctx = setup();
    await sent(ctx);
    ctx.facts.logged.set(`proposal_follow_up:${PROPOSAL}:72:email`, "sent");
    ctx.advance(72 * HOUR + 60_000);
    const r = await runWorker(ctx.deps);
    expect(r.followUps).toEqual({ proposed: 1, skipped: 0, failed: 0 });
    const first = ctx.store.actions[0];
    expect(first.status).toBe("proposed");
    expect(first.payload.existingSequence).toBe("sent");
  });

  it("stops when the client replies", async () => {
    const ctx = setup();
    await sent(ctx);
    ctx.facts.lastContact = new Date(T0 + 10 * HOUR);
    ctx.advance(72 * HOUR + 60_000);
    await runWorker(ctx.deps);
    expect(ctx.store.actions[0]).toMatchObject({ status: "skipped", observedStatus: "responded", reason: "The client replied." });
  });

  it("stops outreach to a client who opted out", async () => {
    const ctx = setup();
    await sent(ctx);
    ctx.facts.contactFacts = { ...ctx.facts.contactFacts!, emailConsent: "revoked" };
    ctx.advance(72 * HOUR + 60_000);
    await runWorker(ctx.deps);
    expect(ctx.store.actions[0].status).toBe("skipped");
    expect(ctx.store.audits.find((a) => a.decision === "followup_skipped")?.inputs).toMatchObject({ consent: "revoked" });
  });

  it("cancels the remaining touches when the proposal is approved", async () => {
    const ctx = setup();
    await sent(ctx);
    ctx.facts.proposals.set(PROPOSAL, { ...ctx.facts.proposals.get(PROPOSAL)!, status: "accepted" });
    await approve(ctx.emit);
    await runWorker(ctx.deps);
    expect(ctx.store.actions.every((a) => a.status === "cancelled")).toBe(true);
  });

  it("skips a touch for a superseded version", async () => {
    const ctx = setup();
    await sent(ctx);
    ctx.facts.proposals.set(PROPOSAL, { ...ctx.facts.proposals.get(PROPOSAL)!, latestProposalIdForJob: NEWER_PROPOSAL });
    ctx.advance(72 * HOUR + 60_000);
    await runWorker(ctx.deps);
    expect(ctx.store.actions[0]).toMatchObject({ status: "skipped", reason: "A newer proposal was sent." });
  });

  it("lets a touch go rather than send it days late after an outage", async () => {
    const ctx = setup();
    await sent(ctx);
    ctx.advance(5 * 24 * HOUR);
    await runWorker(ctx.deps);
    expect(ctx.store.actions[0].status).toBe("skipped");
    expect(ctx.store.actions[0].reason).toMatch(/Too late/);
  });

  it("waits for a person when live and approval is required", async () => {
    const ctx = setup({ dryRun: false });
    await sent(ctx);
    ctx.advance(72 * HOUR + 60_000);
    await runWorker(ctx.deps);
    expect(ctx.store.actions[0].status).toBe("awaiting_approval");
  });
});

describe("delivery", () => {
  it("retries with backoff, then surfaces a dead delivery instead of looping", async () => {
    const { store, deps, emit, facts, advance } = setup();
    facts.failSchedulingFacts = 99;
    await approve(emit);
    for (let i = 0; i < 6; i += 1) {
      await runWorker(deps);
      advance(retryDelayMs(i + 1) + 1000);
    }
    const workflow = store.deliveries.find((d) => d.consumer === "workflow")!;
    expect(workflow.status).toBe("dead");
    expect(workflow.attempts).toBe(5);
    expect(workflow.lastError).toBe("database timed out");
  });

  it("recovers after a transient failure without duplicating anything", async () => {
    const { store, deps, emit, facts, advance } = setup();
    facts.failSchedulingFacts = 1;
    await approve(emit);
    await runWorker(deps);
    expect(store.deliveries.find((d) => d.consumer === "workflow")?.status).toBe("failed");
    advance(retryDelayMs(1) + 1000);
    await runWorker(deps);
    expect(store.deliveries.find((d) => d.consumer === "workflow")?.status).toBe("done");
    expect(store.events.filter((e) => e.type === "job.ready_for_scheduling")).toHaveLength(1);
  });

  it("processes what piled up during a worker outage, once each", async () => {
    const { store, deps, emit, advance } = setup();
    await approve(emit);
    // A worker claimed the batch and died before finishing.
    await store.claim("workflow", 50, 120);
    await runWorker(deps);
    expect(store.events.some((e) => e.type === "job.ready_for_scheduling")).toBe(false);
    advance(121_000);
    await runWorker(deps);
    await runWorker(deps);
    expect(store.events.filter((e) => e.type === "job.ready_for_scheduling")).toHaveLength(1);
    expect(store.tasks.filter((t) => t.kind === "schedule_job")).toHaveLength(1);
  });

  it("holds everything still while the business is paused, without spending attempts", async () => {
    const { store, deps, emit } = setup({ paused: true });
    await approve(emit);
    const r = await runWorker(deps);
    expect(r.deferred).toBe(2);
    expect(store.deliveries.every((d) => d.status === "pending" && d.attempts === 0)).toBe(true);
    expect(store.tasks).toHaveLength(0);
  });

  it("records every decision with the rule and version that made it", async () => {
    const { store, deps, emit } = setup();
    await approve(emit);
    await runWorker(deps);
    const decision = store.audits.find((a) => a.decision === "ready_for_scheduling");
    expect(decision).toMatchObject({ ruleId: "estimate_approved", ruleVersion: 1, organizationId: ORG, entityId: JOB });
  });
});
