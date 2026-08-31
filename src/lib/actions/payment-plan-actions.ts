"use server";

import { revalidatePath } from "next/cache";

import { revalidateJobViews } from "@/lib/revalidate-job";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentProfile } from "@/lib/data/team";
import { getCurrentOrganizationId } from "@/lib/data/organizations";
import { describeDbError } from "@/lib/setup-errors";
import { isStripeConfigured } from "@/lib/env";
import { bookableFromKey } from "@/lib/acceptance-path";
import { stripeClient, stripeCustomerFor } from "@/lib/stripe-customer";
import { methodDetail, paymentMethod } from "@/lib/payment-method";
import {
  buildSchedule,
  checkPlan,
  INTERVALS,
  type Interval,
  type PlanKind,
} from "@/lib/payment-plan";

export type PlanResult =
  | { ok: true; message?: string; planId?: string; url?: string }
  | { ok: false; message: string };

/**
 * Offers a plan to a customer.
 *
 * The schedule is written out here rather than worked out later. What
 * somebody agreed to pay is a fact about a moment, and a schedule recomputed
 * from a total that has since changed is a schedule nobody agreed to.
 */
export async function createPlan(input: {
  /** Null for a plan agreed before there is a project to hang it on, which
   * is most of them -- somebody agrees to pay over three months on the phone
   * and the paperwork follows. */
  jobId: string | null;
  customerId: string;
  proposalId?: string | null;
  /** The bill this plan pays off, when it was agreed against one. */
  invoiceId?: string | null;
  kind: PlanKind;
  totalCents: number;
  depositCents?: number;
  instalments?: number;
  interval?: Interval;
  /** The day the schedule counts from. Today when not given. */
  startOn?: string;
  /**
   * True when somebody in the office is writing down an agreement that has
   * already happened -- a customer said yes on the phone. A plan offered
   * through a proposal starts as an offer and is accepted separately; one
   * typed in by hand was never an offer, and leaving it at 'offered' would
   * show an agreed schedule as still waiting on the customer.
   */
  alreadyAgreed?: boolean;
}): Promise<PlanResult> {
  try {
    const profile = await getCurrentProfile();
    if (!profile) return { ok: false, message: "Sign in first." };

    const verdict = checkPlan(input);
    if (!verdict.ok) return { ok: false, message: verdict.reason };

    const [supabase, organizationId] = await Promise.all([
      createClient(),
      getCurrentOrganizationId(),
    ]);

    const { data: plan, error } = await supabase
      .from("payment_plans")
      .insert({
        organization_id: organizationId,
        job_id: input.jobId ?? null,
        proposal_id: input.proposalId ?? null,
        invoice_id: input.invoiceId ?? null,
        customer_id: input.customerId,
        kind: input.kind,
        total_cents: input.totalCents,
        deposit_cents: input.depositCents ?? 0,
        instalments: input.kind === "instalments" ? input.instalments ?? null : null,
        interval: input.interval ?? null,
        ...(input.alreadyAgreed
          ? {
              status: "accepted" as const,
              accepted_at: new Date().toISOString(),
              accepted_by: profile.id,
            }
          : {}),
        created_by: profile.id,
      })
      .select("id")
      .maybeSingle();

    if (error || !plan) return { ok: false, message: describeDbError(error) };

    const schedule = buildSchedule(input);
    // A plan agreed last week starts last week. Dating every instalment from
    // the day somebody typed it in makes the first one late on arrival.
    const start = startDate(input.startOn);
    const { error: scheduleError } = await supabase.from("payment_plan_instalments").insert(
      schedule.map((item) => ({
        plan_id: plan.id,
        number: item.number,
        amount_cents: item.amountCents,
        due_on: addDays(start, item.dueInDays),
        is_deposit: item.isDeposit,
      }))
    );

    if (scheduleError) return { ok: false, message: describeDbError(scheduleError) };

    refresh(input.jobId);
    return { ok: true, planId: plan.id, message: "Plan offered." };
  } catch (err) {
    console.error("createPlan failed:", err);
    return { ok: false, message: "Couldn't set that plan up." };
  }
}

/**
 * Takes the first payment.
 *
 * A Checkout session for a one-off or a deposit; a subscription for anything
 * recurring. The rest of an instalment plan is invoiced on its due dates
 * rather than charged now — a card on file today is not consent to take
 * money in three months, and Stripe's own invoice is what gives the customer
 * something to look at each time.
 */
export async function startPlanPayment(planId: string, returnTo: string): Promise<PlanResult> {
  try {
    const profile = await getCurrentProfile();
    if (!profile) return { ok: false, message: "Sign in first." };
    if (!isStripeConfigured) {
      return { ok: false, message: "Stripe isn't connected yet — add the keys and try again." };
    }

    const supabase = await createClient();
    const { data: plan } = await supabase
      .from("payment_plans")
      .select("id, kind, customer_id, job_id, total_cents, deposit_cents, interval")
      .eq("id", planId)
      .maybeSingle();

    if (!plan) return { ok: false, message: "That plan isn't there." };

    const stripeCustomerId = await stripeCustomerFor(plan.customer_id);
    if (!stripeCustomerId) return { ok: false, message: "Couldn't find that contact in Stripe." };

    const stripe = stripeClient();

    if (plan.kind === "subscription") {
      const days = INTERVALS.find((i) => i.value === plan.interval)?.days ?? 30;
      const session = await stripe.checkout.sessions.create({
        mode: "subscription",
        customer: stripeCustomerId,
        line_items: [
          {
            price_data: {
              currency: "usd",
              unit_amount: plan.total_cents,
              product_data: { name: "Landscaping — recurring" },
              recurring: { interval: stripeInterval(days) },
            },
            quantity: 1,
          },
        ],
        success_url: returnTo,
        cancel_url: returnTo,
        metadata: { plan_id: plan.id, job_id: plan.job_id ?? "" },
      });

      return { ok: true, url: session.url ?? undefined };
    }

    // The first thing owed: the deposit if there is one, otherwise the first
    // payment in the schedule.
    const { data: first } = await supabase
      .from("payment_plan_instalments")
      .select("id, amount_cents, number")
      .eq("plan_id", plan.id)
      .eq("status", "due")
      .order("number")
      .limit(1)
      .maybeSingle();

    if (!first) return { ok: false, message: "Nothing outstanding on that plan." };

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      customer: stripeCustomerId,
      line_items: [
        {
          price_data: {
            currency: "usd",
            unit_amount: first.amount_cents,
            product_data: { name: `Landscaping — payment ${first.number}` },
          },
          quantity: 1,
        },
      ],
      success_url: returnTo,
      cancel_url: returnTo,
      // Read back by the webhook so the payment lands on the right instalment
      // rather than being an amount that arrived from somebody.
      metadata: {
        plan_id: plan.id,
        instalment_id: first.id,
        job_id: plan.job_id ?? "",
      },
    });

    return { ok: true, url: session.url ?? undefined };
  } catch (err) {
    console.error("startPlanPayment failed:", err);
    return { ok: false, message: "Couldn't start that payment." };
  }
}

/** Somebody in the office saying the customer agreed to it. */
export async function acceptPlan(planId: string, jobId: string): Promise<PlanResult> {
  try {
    const profile = await getCurrentProfile();
    if (!profile) return { ok: false, message: "Sign in first." };

    const supabase = await createClient();
    const { error } = await supabase
      .from("payment_plans")
      .update({
        status: "accepted",
        accepted_at: new Date().toISOString(),
        accepted_by: profile.id,
      })
      .eq("id", planId);

    if (error) return { ok: false, message: describeDbError(error) };

    refresh(jobId);
    return { ok: true, message: "Accepted." };
  } catch (err) {
    console.error("acceptPlan failed:", err);
    return { ok: false, message: "Couldn't accept that." };
  }
}

/**
 * Money that arrived some other way.
 *
 * Cash and cheques are real payments and belong in the same ledger, or the
 * outstanding figure is only ever right for the customers who paid by card.
 */
export async function recordManualPayment(input: {
  /** Null when the money is not against a project. Most of the back
   * catalogue is money with no project, and refusing to record it until
   * somebody makes one is how it stays unrecorded. */
  jobId: string | null;
  customerId: string;
  planId?: string | null;
  instalmentId?: string | null;
  amountCents: number;
  /** Anything the export or the office says. Folded to what the column
   * takes, so "Debit Card" does not fail the check constraint. */
  method: string;
  /** The day the money arrived, not the day it was typed in. A payment
   * filed under today because nobody asked is a payment on the wrong side
   * of a month end. */
  receivedAt?: string;
  note?: string;
}): Promise<PlanResult> {
  try {
    const profile = await getCurrentProfile();
    if (!profile) return { ok: false, message: "Sign in first." };
    if (!(input.amountCents > 0)) return { ok: false, message: "How much?" };

    const [supabase, organizationId] = await Promise.all([
      createClient(),
      getCurrentOrganizationId(),
    ]);

    const received = receivedOn(input.receivedAt);

    const { error } = await supabase.from("payments").insert({
      organization_id: organizationId,
      customer_id: input.customerId,
      job_id: input.jobId ?? null,
      plan_id: input.planId ?? null,
      instalment_id: input.instalmentId ?? null,
      amount_cents: input.amountCents,
      method: paymentMethod(input.method),
      // Omitted rather than nulled when no date was given, so the column's
      // own default of now() applies instead of a null it will not take.
      ...(received ? { received_at: received } : {}),
      note: [input.note?.trim(), methodDetail(input.method)].filter(Boolean).join(" · ") || null,
      recorded_by: profile.id,
      source: "manual",
    });

    if (error) return { ok: false, message: describeDbError(error) };

    if (input.instalmentId) {
      await supabase
        .from("payment_plan_instalments")
        .update({ status: "paid", paid_at: new Date().toISOString() })
        .eq("id", input.instalmentId);
    }

    refresh(input.jobId);
    return { ok: true, message: "Recorded." };
  } catch (err) {
    console.error("recordManualPayment failed:", err);
    return { ok: false, message: "Couldn't record that." };
  }
}

/**
 * Records a payment Stripe told us about.
 *
 * Called from the webhook with the admin client, because a webhook has no
 * signed-in person and no organisation in context. Unique on the payment
 * intent, so a webhook delivered twice records one payment — Stripe retries
 * on any non-2xx, and a duplicate row is a customer who appears to have paid
 * twice.
 */
export async function recordStripePayment(input: {
  organizationId: string;
  customerId: string | null;
  jobId: string | null;
  planId: string | null;
  instalmentId: string | null;
  amountCents: number;
  paymentIntentId: string | null;
  invoiceId: string | null;
}): Promise<void> {
  const admin = createAdminClient();

  await admin.from("payments").upsert(
    {
      organization_id: input.organizationId,
      customer_id: input.customerId,
      job_id: input.jobId,
      plan_id: input.planId,
      instalment_id: input.instalmentId,
      amount_cents: input.amountCents,
      method: "card",
      stripe_payment_intent_id: input.paymentIntentId,
      stripe_invoice_id: input.invoiceId,
    },
    { onConflict: "stripe_payment_intent_id", ignoreDuplicates: true }
  );

  if (input.instalmentId) {
    await admin
      .from("payment_plan_instalments")
      .update({ status: "paid", paid_at: new Date().toISOString() })
      .eq("id", input.instalmentId);
  }

  if (input.planId) {
    await settleIfPaidOff(input.planId);
  }
}

/**
 * Closes a plan once nothing is left owing on it, and books the job.
 *
 * A plan that was protecting a discount held the booking back until the
 * balance was cleared, so this is the moment that condition is met. The start
 * date goes one month out from today, which is the rule the client was told
 * on the screen where they chose to pay this way.
 */
async function settleIfPaidOff(planId: string): Promise<void> {
  const admin = createAdminClient();

  const { data: outstanding } = await admin
    .from("payment_plan_instalments")
    .select("id")
    .eq("plan_id", planId)
    .eq("status", "due")
    .limit(1);

  const settled = !outstanding || outstanding.length === 0;

  await admin
    .from("payment_plans")
    .update({ status: settled ? "settled" : "active" })
    .eq("id", planId);

  if (!settled) return;

  const { data: plan } = await admin
    .from("payment_plans")
    .select("job_id, schedules_after_final_payment")
    .eq("id", planId)
    .maybeSingle();

  if (!plan?.job_id || !plan.schedules_after_final_payment) return;

  // Only fills a start date in, never moves one somebody has already set: the
  // office may well have booked them in the meantime, and overwriting that
  // would move a date a client has been given.
  const { data: job } = await admin
    .from("jobs")
    .select("project_start_date")
    .eq("id", plan.job_id)
    .maybeSingle();
  if (job?.project_start_date) return;

  await admin
    .from("jobs")
    .update({ project_start_date: bookableFromKey(new Date()) })
    .eq("id", plan.job_id);
}

/** The day a schedule counts from: what was asked for, or today. */
function startDate(value: string | undefined): Date {
  const text = value?.trim();
  if (text && /^\d{4}-\d{2}-\d{2}$/.test(text)) {
    const parsed = new Date(`${text}T00:00:00`);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return new Date();
}

/** A received date the database will take, or null for "now". */
function receivedOn(value: string | undefined): string | null {
  const text = value?.trim();
  return text && /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

function addDays(from: Date, days: number): string {
  const date = new Date(from);
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Stripe only bills day, week, month or year — the rest is a multiplier. */
function stripeInterval(days: number): "day" | "week" | "month" | "year" {
  if (days <= 7) return "week";
  if (days <= 31) return "month";
  if (days <= 92) return "month";
  return "year";
}

function refresh(jobId: string | null) {
  // A plan paying off can set the project start date, which moves the card.
  // Money can also be recorded against a contact with no project at all --
  // most of the imported back catalogue is exactly that -- so the project
  // half is skipped rather than the whole call being unavailable.
  if (jobId) revalidateJobViews(jobId);
  revalidatePath("/admin/payments");
  revalidatePath("/pipeline");
}
