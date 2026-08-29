"use server";

import { createHash } from "node:crypto";

import { revalidateJobViews } from "@/lib/revalidate-job";
import { headers } from "next/headers";

import { createAdminClient } from "@/lib/supabase/admin";
import { createAndSendInvoice } from "@/lib/invoicing";
import { isStripeConfigured } from "@/lib/env";
import { stripeClient, stripeCustomerFor } from "@/lib/stripe-customer";
import { getJobCustomerContact } from "@/lib/job-customer";
import { notifyJobTeam } from "@/lib/notifications";
import { reduceScope, type ScopeLine } from "@/lib/objections";
import { amountForPath, confirmationFor, optionById } from "@/lib/acceptance-path";
import { startProposalCheckout } from "@/lib/proposal-checkout";
import { previewResult, schedulePath } from "@/lib/proposal-flow";
import { isSameSitting } from "@/lib/proposal-views";
import { offeredWorkDays } from "@/lib/data/work-day-offer";
import { buildSchedule, checkPlan } from "@/lib/payment-plan";
import type { ProposalZoneSnapshot } from "@/types/domain";

/**
 * The client's Accept/Decline click — no logged-in user exists, so this runs
 * entirely on the service-role client (same pattern as /book). Accepting
 * moves the underlying job to "approved" directly and sends the invoice;
 * nothing else touches that transition today, so this is the one real
 * conversion action.
 */
export async function respondToProposal(token: string, response: "accepted" | "declined", note: string) {
  if (response !== "accepted" && response !== "declined") throw new Error("Invalid response.");

  const admin = createAdminClient();
  const { data: proposal, error } = await admin
    .from("job_proposals")
    .select("id, job_id, status, total_cost, discount_amount")
    .eq("token", token)
    .maybeSingle();
  if (error) throw error;
  if (!proposal) throw new Error("This proposal link isn't valid.");
  if (proposal.status === "needs_approval") throw new Error("This proposal isn't ready yet — check back soon.");
  if (proposal.status !== "sent") throw new Error("This proposal has already been responded to.");

  const { error: updateError } = await admin
    .from("job_proposals")
    .update({
      status: response,
      responded_at: new Date().toISOString(),
      client_response_note: note.trim() || null,
    })
    .eq("id", proposal.id);
  if (updateError) throw updateError;

  notifyJobTeam(
    proposal.job_id,
    "proposal_responses",
    `A client ${response} their proposal.`,
    { dedupeKey: proposal.id }
  ).catch(() => {
    // Best-effort — the client's response is already recorded.
  });

  if (response === "accepted") {
    const { error: jobError } = await admin.from("jobs").update({ status: "approved" }).eq("id", proposal.job_id);
    if (jobError) throw jobError;

    // No invoice here any more. Accepting used to fire one for the whole
    // amount immediately, which took the choice about how to pay away from
    // the client before they were asked. The next screen asks; whichever way
    // they answer raises the right paperwork.
  }

  // Every screen, not just this job and the list. The pipeline reads the
  // proposal status too, and a card left in the old column is what a client
  // signing looks like when only half the caches are cleared.
  revalidateJobViews(proposal.job_id);
}

// ---------------------------------------------------------------------------
// Questions from the client, before they decide
// ---------------------------------------------------------------------------

/** Results rather than throws — a thrown Server Action loses its message in
 * production and surfaces to a client as an unexplained crash, on the one
 * page where that costs a job. */
export type PublicResult<T = Record<string, never>> =
  | ({ ok: true } & T)
  | { ok: false; message: string };

/**
 * What a client is told when something breaks.
 *
 * Deliberately says nothing. This used to return the underlying message,
 * which meant a missing column or a constraint name went onto a paying
 * customer's screen. The real error is logged where the office can find it;
 * the client gets a sentence they can act on.
 */
function describe(err: unknown): string {
  if (err) console.error("public proposal action failed:", err);
  return "Something went wrong on our end. Please try again, or contact us and we will sort it out.";
}

/** The proposal behind a link, or null. Never leaks why it failed. */
async function proposalForToken(token: string) {
  const admin = createAdminClient();
  const { data } = await admin
    .from("job_proposals")
    .select("id, job_id, organization_id, status, total_cost, discount_amount, scope_snapshot")
    .eq("token", token)
    .maybeSingle();
  return data;
}

/**
 * Record that a client tapped a question, and whether our answer settled it.
 *
 * Called twice for one objection: once when they open it, and again with
 * `resolved` once they say whether it helped. Two rows would double-count the
 * objection and halve the apparent answer rate, so the second call updates
 * the first.
 */
export async function recordObjection(input: {
  token: string;
  objectionId: string;
  resolution?: "explain" | "payment_plan" | "reduce_scope" | "talk" | null;
  resolved?: boolean | null;
  note?: string | null;
  /** Set by the internal preview, which reads the client's real proposal. */
  preview?: boolean;
}): Promise<PublicResult<{ id: string }>> {
  try {
    if (input.preview) return previewResult();

    const proposal = await proposalForToken(input.token);
    if (!proposal) return { ok: false, message: "This proposal link isn't valid." };

    const admin = createAdminClient();
    const note = input.note?.trim() || null;

    // The open-then-answer pair. Matched on the most recent unanswered row for
    // this objection so a client who opens the same question twice in one
    // sitting does not leave a half-finished row behind.
    const { data: open } = await admin
      .from("proposal_objections")
      .select("id")
      .eq("proposal_id", proposal.id)
      .eq("objection_id", input.objectionId)
      .is("resolved", null)
      .order("raised_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (open?.id) {
      const { error } = await admin
        .from("proposal_objections")
        .update({
          resolution: input.resolution ?? null,
          resolved: input.resolved ?? null,
          note,
        })
        .eq("id", open.id);
      if (error) return { ok: false, message: describe(error) };
      return { ok: true, id: open.id };
    }

    const { data: created, error } = await admin
      .from("proposal_objections")
      .insert({
        organization_id: proposal.organization_id,
        proposal_id: proposal.id,
        objection_id: input.objectionId,
        resolution: input.resolution ?? null,
        resolved: input.resolved ?? null,
        note,
      })
      .select("id")
      .single();
    if (error || !created) return { ok: false, message: describe(error) };

    // Worth waking somebody for only when we failed to answer it. A client
    // reading the stock answer and moving on is not news.
    if (input.resolved === false || note) {
      notifyJobTeam(
        proposal.job_id,
        "proposal_responses",
        "A client has a question we couldn't answer on their proposal.",
        { dedupeKey: `${proposal.id}:${input.objectionId}` }
      ).catch(() => {});
    }

    return { ok: true, id: created.id };
  } catch (err) {
    return { ok: false, message: describe(err) };
  }
}

/**
 * A client asking to keep only part of the work.
 *
 * Re-prices where every line came off the rate card, and refers to a person
 * where it did not — a hand-entered price, an agreed discount, or a line we
 * never captured a price for. The client is told which happened, because a
 * quote whose number moves on its own is worse than one that takes a day.
 */
export async function requestScopeChange(input: {
  token: string;
  keepZones: string[];
  /** Set by the internal preview, which reads the client's real proposal. */
  preview?: boolean;
}): Promise<PublicResult<{ applied: boolean; newTotalCents: number | null; reviewReason: string | null }>> {
  try {
    if (input.preview) return previewResult();

    const proposal = await proposalForToken(input.token);
    if (!proposal) return { ok: false, message: "This proposal link isn't valid." };
    if (proposal.status !== "sent") {
      return { ok: false, message: "This proposal has already been responded to." };
    }

    const snapshot = (proposal.scope_snapshot ?? []) as unknown as ProposalZoneSnapshot[];
    const lines: ScopeLine[] = snapshot.map((z) => ({
      zoneName: z.zoneName,
      serviceLabel: z.serviceLabel,
      priceCents: z.priceCents ?? null,
      priceDerived: z.priceDerived ?? false,
    }));

    const statedTotalCents = Math.round((proposal.total_cost ?? 0) * 100);
    const discountCents = Math.round((proposal.discount_amount ?? 0) * 100);
    const change = reduceScope(lines, input.keepZones, { discountCents, statedTotalCents });

    if (change.droppedNames.length === 0) {
      return { ok: false, message: "Nothing was removed — pick the areas you'd like to keep." };
    }
    if (change.keptNames.length === 0) {
      return { ok: false, message: change.reviewReason ?? "Keep at least one area." };
    }

    const admin = createAdminClient();
    const { error } = await admin.from("proposal_scope_requests").insert({
      organization_id: proposal.organization_id,
      proposal_id: proposal.id,
      kept_zones: change.keptNames,
      dropped_zones: change.droppedNames,
      previous_total_cents: statedTotalCents,
      new_total_cents: change.newTotalCents,
      status: change.auto ? "applied" : "needs_review",
      review_reason: change.reviewReason,
    });
    if (error) return { ok: false, message: describe(error) };

    // Only rewrite the proposal when the price stood on its own. Trimming the
    // scope without a price behind it would leave the client looking at work
    // they did not agree to at a number nobody calculated.
    if (change.auto && change.newTotalCents != null) {
      const keep = new Set(change.keptNames);
      const { error: updateError } = await admin
        .from("job_proposals")
        .update({
          total_cost: change.newTotalCents / 100,
          scope_snapshot: snapshot.filter((z) => keep.has(z.zoneName)),
        })
        .eq("id", proposal.id);
      if (updateError) return { ok: false, message: describe(updateError) };
    }

    notifyJobTeam(
      proposal.job_id,
      "proposal_responses",
      change.auto
        ? "A client trimmed their proposal — the price updated automatically."
        : "A client asked to change their proposal scope. Needs a new price.",
      { dedupeKey: `${proposal.id}:scope` }
    ).catch(() => {});

    revalidateJobViews(proposal.job_id);

    return {
      ok: true,
      applied: change.auto,
      newTotalCents: change.newTotalCents,
      reviewReason: change.reviewReason,
    };
  } catch (err) {
    return { ok: false, message: describe(err) };
  }
}

// ---------------------------------------------------------------------------
// What happens straight after accepting
// ---------------------------------------------------------------------------

/**
 * The client choosing how to pay, and by doing so, when they get booked.
 *
 * Runs on the service-role client: this is a person with an emailed link and
 * no account, which is the same footing as accepting in the first place.
 *
 * Recording the choice on the proposal is what makes this safe to press
 * twice. A phone that resent the request would otherwise raise a second
 * invoice or a second payment plan against the same job.
 */
export async function choosePaymentPath(input: {
  token: string;
  pathId: string;
  /** How many payments to split it into. Ignored for paying in full. */
  instalments?: number;
  /** Set by the internal preview, which reads the client's real proposal. */
  preview?: boolean;
}): Promise<PublicResult<{ message: string; checkoutUrl?: string; next?: string }>> {
  try {
    if (input.preview) return previewResult();

    const admin = createAdminClient();

    const { data: proposal } = await admin
      .from("job_proposals")
      .select("id, job_id, organization_id, status, total_cost, discount_amount, payment_path")
      .eq("token", input.token)
      .maybeSingle();

    if (!proposal) return { ok: false, message: "This proposal link isn't valid." };
    if (proposal.status !== "accepted") {
      return { ok: false, message: "Accept the proposal first." };
    }
    if (proposal.payment_path) {
      return { ok: false, message: "You've already chosen how to pay. We'll be in touch." };
    }

    const discountCents = Math.round((proposal.discount_amount ?? 0) * 100);
    const context = {
      discountCents,
      totalCents: Math.max(0, Math.round((proposal.total_cost ?? 0) * 100) - discountCents),
    };

    const option = optionById(context, input.pathId);
    if (!option) return { ok: false, message: "Pick one of the options." };

    const amountCents = amountForPath(context, option);
    if (amountCents <= 0) return { ok: false, message: "There is nothing to pay on this one." };

    // Claim the choice before doing the work. Two taps on a slow connection
    // otherwise both get past the check above and raise two of everything.
    const { data: claimed } = await admin
      .from("job_proposals")
      .update({ payment_path: option.id, payment_path_at: new Date().toISOString() })
      .eq("id", proposal.id)
      .is("payment_path", null)
      .select("id")
      .maybeSingle();
    if (!claimed) return { ok: false, message: "You've already chosen how to pay. We'll be in touch." };

    // What is owed right now, and what to call it on their receipt. Paying
    // in full is the whole amount; a plan is its first payment, because a
    // plan whose first payment is left for later is a promise, not a sale.
    let dueNowCents = amountCents;
    let description = "Landscaping services";
    let planId: string | null = null;
    let instalmentId: string | null = null;

    if (option.id !== "full") {
      const built = await buildClientPlan({
        organizationId: proposal.organization_id,
        jobId: proposal.job_id,
        proposalId: proposal.id,
        amountCents,
        instalments: input.instalments ?? 3,
        keepsDiscount: option.keepsDiscount,
        schedulesAfterFinalPayment: option.schedulesAfterFinalPayment,
      });
      if (!built.ok) return built;
      dueNowCents = built.firstAmountCents;
      description = `Landscaping services, payment 1 of ${built.instalments}`;
      planId = built.planId;
      instalmentId = built.instalmentId;
    }

    // Checkout rather than an emailed invoice. A card form in front of
    // somebody who has already decided gets paid; a link in an inbox
    // tomorrow is a second decision, and plenty of those never got made.
    let checkoutUrl: string | undefined;
    try {
      const started = await startProposalCheckout({
        token: input.token,
        jobId: proposal.job_id,
        proposalId: proposal.id,
        organizationId: proposal.organization_id,
        amountCents: dueNowCents,
        description,
        planId,
        instalmentId,
      });
      if (started) {
        checkoutUrl = started.url;
        await admin
          .from("job_proposals")
          .update({ checkout_session_id: started.sessionId })
          .eq("id", proposal.id);
      }
    } catch {
      // Fall through to the invoice. The choice is already recorded, and a
      // payment we could not start is not a reason to lose it.
    }

    if (!checkoutUrl && option.id === "full") {
      // Best-effort, like acceptance itself: an invoice that failed to send
      // is something the office can see and resend rather than a decision
      // that got lost.
      createAndSendInvoice(proposal.job_id, proposal.id, dueNowCents / 100).catch(() => {});
    }

    notifyJobTeam(
      proposal.job_id,
      "proposal_responses",
      option.id === "full"
        ? "A client accepted and is paying in full."
        : "A client accepted and set up a payment plan.",
      { dedupeKey: `${proposal.id}:path` }
    ).catch(() => {});

    revalidateJobViews(proposal.job_id);

    return {
      ok: true,
      message: confirmationFor(option),
      checkoutUrl,
      next: schedulePath(input.token),
    };
  } catch (err) {
    return { ok: false, message: describe(err) };
  }
}

/**
 * The plan itself, written without a signed-in user.
 *
 * createPlan in payment-plan-actions is the office's version and needs a
 * profile to attribute it to. Nobody is signed in here, so the rows are
 * written directly with the same schedule maths rather than loosening that
 * function's requirements for everybody.
 */
async function buildClientPlan(input: {
  organizationId: string;
  jobId: string;
  proposalId: string;
  amountCents: number;
  instalments: number;
  keepsDiscount: boolean;
  schedulesAfterFinalPayment: boolean;
}): Promise<
  | {
      ok: true;
      planId: string;
      instalmentId: string | null;
      firstAmountCents: number;
      instalments: number;
    }
  | { ok: false; message: string }
> {
  const admin = createAdminClient();

  const { data: job } = await admin
    .from("jobs")
    .select("properties(customer_id)")
    .eq("id", input.jobId)
    .maybeSingle();
  const customerId =
    (job as unknown as { properties: { customer_id: string } | null } | null)?.properties
      ?.customer_id ?? null;
  if (!customerId) return { ok: false, message: "We couldn't match this to your account." };

  const planInput = {
    totalCents: input.amountCents,
    kind: "instalments" as const,
    // Clamped rather than refused: a number arriving from a form is not worth
    // failing a payment over, and the schedule maths is exact at any count.
    instalments: Math.min(12, Math.max(2, Math.round(input.instalments))),
    interval: "monthly" as const,
  };

  const verdict = checkPlan(planInput);
  if (!verdict.ok) return { ok: false, message: verdict.reason };

  const { data: plan, error } = await admin
    .from("payment_plans")
    .insert({
      organization_id: input.organizationId,
      job_id: input.jobId,
      proposal_id: input.proposalId,
      customer_id: customerId,
      kind: planInput.kind,
      total_cents: planInput.totalCents,
      instalments: planInput.instalments,
      interval: planInput.interval,
      // The client agreed to it on this screen, so it is accepted already.
      status: "accepted",
      accepted_at: new Date().toISOString(),
      keeps_discount: input.keepsDiscount,
      schedules_after_final_payment: input.schedulesAfterFinalPayment,
    })
    .select("id")
    .maybeSingle();

  if (error || !plan) return { ok: false, message: describe(error) };

  const today = new Date();
  const schedule = buildSchedule(planInput);
  const { data: written, error: scheduleError } = await admin
    .from("payment_plan_instalments")
    .insert(
      schedule.map((item) => {
        const due = new Date(today.getTime());
        due.setDate(due.getDate() + item.dueInDays);
        return {
          plan_id: plan.id,
          number: item.number,
          amount_cents: item.amountCents,
          due_on: due.toISOString().slice(0, 10),
          is_deposit: item.isDeposit,
        };
      })
    )
    .select("id, number, amount_cents");
  if (scheduleError) return { ok: false, message: describe(scheduleError) };

  // The one they pay on this screen: the deposit if there is one, otherwise
  // payment one. Read back from what was written rather than recalculated,
  // so the amount charged is the amount the schedule says is owed.
  const first = (written ?? [])
    .slice()
    .sort((a, b) => a.number - b.number)[0] ?? null;

  return {
    ok: true,
    planId: plan.id,
    instalmentId: first?.id ?? null,
    firstAmountCents: first?.amount_cents ?? schedule[0]?.amountCents ?? 0,
    instalments: schedule.length,
  };
}

// ---------------------------------------------------------------------------
// Picking the day
// ---------------------------------------------------------------------------

/**
 * The client choosing which day the crew comes.
 *
 * The day is checked against the same list the page drew rather than taken
 * on trust. A date arriving from a form is just a string, and the two things
 * it must not be are a day the crew is already full on and a day we have
 * blocked for rain.
 */
export async function chooseWorkDay(input: {
  token: string;
  date: string;
  preview?: boolean;
}): Promise<PublicResult<{ message: string; date: string }>> {
  try {
    if (input.preview) return previewResult();

    const admin = createAdminClient();
    const { data: proposal } = await admin
      .from("job_proposals")
      .select("id, job_id, organization_id, status, payment_path, client_chosen_day")
      .eq("token", input.token)
      .maybeSingle();

    if (!proposal) return { ok: false, message: "This proposal link isn't valid." };
    if (proposal.status !== "accepted") return { ok: false, message: "Accept the proposal first." };
    if (proposal.client_chosen_day) {
      return { ok: false, message: "You have already picked a day. We will be in touch." };
    }

    const offer = await offeredWorkDays({
      jobId: proposal.job_id,
      organizationId: proposal.organization_id,
    });
    const day = offer.days.find((d) => d.date === input.date);
    if (!day) return { ok: false, message: "That day isn't one we can offer. Pick another." };
    if (day.status !== "open") {
      return { ok: false, message: `${day.label} is ${day.reason?.toLowerCase() ?? "not available"}.` };
    }

    // Claim it before writing the job, so two taps on a slow connection do
    // not book the crew twice.
    const { data: claimed } = await admin
      .from("job_proposals")
      .update({ client_chosen_day: day.date, client_chosen_day_at: new Date().toISOString() })
      .eq("id", proposal.id)
      .is("client_chosen_day", null)
      .select("id")
      .maybeSingle();
    if (!claimed) return { ok: false, message: "You have already picked a day. We will be in touch." };

    const { error: jobError } = await admin
      .from("jobs")
      // Status stays "approved": the job is booked, not started. A start
      // date is what the schedule reads, and moving the status here would
      // tell the crew work is underway on a day nobody has been out.
      .update({ project_start_date: day.date })
      .eq("id", proposal.job_id);
    if (jobError) return { ok: false, message: describe(jobError) };

    notifyJobTeam(proposal.job_id, "proposal_responses", `A client booked themselves in for ${day.label}.`, {
      dedupeKey: `${proposal.id}:day`,
    }).catch(() => {});

    revalidateJobViews(proposal.job_id);

    return { ok: true, date: day.date, message: `You are booked in for ${day.label}.` };
  } catch (err) {
    return { ok: false, message: describe(err) };
  }
}

// ---------------------------------------------------------------------------
// Did they actually open it
// ---------------------------------------------------------------------------

/**
 * Log that a client opened their proposal.
 *
 * Silent in every direction. It returns nothing the page uses, it never
 * throws, and a failure here is not allowed to be visible: proposals are
 * already out with clients, and a counter for the office is not worth a
 * broken page for any of them. If the table is missing because the migration
 * has not been run, the client sees exactly what they saw before.
 *
 * Not counted: the internal preview, and a client who refreshes or comes
 * back from a photo they tapped. Those are the same sitting, and a number
 * inflated by them is a number nobody can act on.
 */
export async function recordProposalView(input: {
  token: string;
  preview?: boolean;
}): Promise<void> {
  try {
    if (input.preview) return;

    const admin = createAdminClient();
    const { data: proposal } = await admin
      .from("job_proposals")
      .select("id")
      .eq("token", input.token)
      .maybeSingle();
    if (!proposal) return;

    // Roughly who, without keeping anything about them. Salted with the
    // proposal's own id so the same person's visits to two proposals cannot
    // be lined up against each other.
    const list = await headers();
    const fingerprint = [
      list.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "",
      list.get("user-agent") ?? "",
    ].join("|");
    const visitorHash = fingerprint.trim()
      ? createHash("sha256").update(`${proposal.id}:${fingerprint}`).digest("hex").slice(0, 32)
      : null;

    if (visitorHash) {
      const { data: last } = await admin
        .from("proposal_views")
        .select("viewed_at")
        .eq("proposal_id", proposal.id)
        .eq("visitor_hash", visitorHash)
        .order("viewed_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (isSameSitting(last?.viewed_at ?? null, new Date())) return;
    }

    await admin.from("proposal_views").insert({
      proposal_id: proposal.id,
      visitor_hash: visitorHash,
      viewed_at: new Date().toISOString(),
    });
  } catch {
    // Deliberately silent. Nothing the client can see depends on this.
  }
}

/**
 * Start a payment the client can finish without leaving the page.
 *
 * The hosted checkout worked, but it is a redirect to somebody else's page
 * where the wallet buttons are one row among several. What a client actually
 * wants is the sheet their phone already has their card, name and address
 * in, opening the moment they say how they are paying. That needs a payment
 * intent rather than a checkout session, so the browser can raise Apple Pay
 * or Google Pay itself.
 *
 * The same claim on payment_path as choosePaymentPath, and the same plan
 * built behind it, so the two ways of paying cannot produce two different
 * pieces of paperwork.
 */
export async function startProposalPayment(input: {
  token: string;
  pathId: string;
  instalments?: number;
  preview?: boolean;
}): Promise<PublicResult<{ clientSecret: string; amountCents: number }>> {
  try {
    if (input.preview) return previewResult();
    if (!isStripeConfigured) {
      return { ok: false, message: "Card payments aren't switched on yet. Give us a ring." };
    }

    const admin = createAdminClient();
    const { data: proposal } = await admin
      .from("job_proposals")
      .select("id, job_id, organization_id, status, total_cost, discount_amount, payment_path")
      .eq("token", input.token)
      .maybeSingle();

    if (!proposal) return { ok: false, message: "This proposal link isn't valid." };
    if (proposal.status !== "accepted") return { ok: false, message: "Accept the proposal first." };

    const discountCents = Math.round((proposal.discount_amount ?? 0) * 100);
    const context = {
      discountCents,
      totalCents: Math.max(0, Math.round((proposal.total_cost ?? 0) * 100) - discountCents),
    };
    const option = optionById(context, input.pathId);
    if (!option) return { ok: false, message: "Pick one of the options." };

    const amountCents = amountForPath(context, option);
    if (!(amountCents > 0)) return { ok: false, message: "There is nothing to pay on this one." };

    // Claimed before any money is raised, exactly as the redirect path does,
    // so two taps cannot produce two plans.
    if (!proposal.payment_path) {
      const { data: claimed } = await admin
        .from("job_proposals")
        .update({ payment_path: option.id, payment_path_at: new Date().toISOString() })
        .eq("id", proposal.id)
        .is("payment_path", null)
        .select("id")
        .maybeSingle();

      if (claimed && option.id !== "full") {
        const built = await buildClientPlan({
          organizationId: proposal.organization_id,
          jobId: proposal.job_id,
          proposalId: proposal.id,
          amountCents,
          instalments: input.instalments ?? 3,
          keepsDiscount: option.keepsDiscount,
          schedulesAfterFinalPayment: option.schedulesAfterFinalPayment,
        });
        if (!built.ok) return built;
      }
    }

    const contact = await getJobCustomerContact(proposal.job_id);
    const existing = contact?.customerId ? await stripeCustomerFor(contact.customerId) : null;

    const intent = await stripeClient().paymentIntents.create({
      amount: amountCents,
      currency: "usd",
      // Lets Stripe offer the wallets and Link the browser can actually use,
      // rather than us guessing which and hiding the rest.
      automatic_payment_methods: { enabled: true },
      ...(existing ? { customer: existing } : {}),
      ...(contact?.email ? { receipt_email: contact.email } : {}),
      metadata: {
        proposal_id: proposal.id,
        organization_id: proposal.organization_id,
        job_id: proposal.job_id,
      },
    });

    if (!intent.client_secret) {
      return { ok: false, message: "Couldn't start that payment. Try again." };
    }

    await admin
      .from("job_proposals")
      .update({ checkout_session_id: intent.id })
      .eq("id", proposal.id);

    return { ok: true, clientSecret: intent.client_secret, amountCents };
  } catch (err) {
    return { ok: false, message: describe(err) };
  }
}
