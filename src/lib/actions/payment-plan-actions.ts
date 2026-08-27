"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentProfile } from "@/lib/data/team";
import { getCurrentOrganizationId } from "@/lib/data/organizations";
import { describeDbError } from "@/lib/setup-errors";
import { isStripeConfigured } from "@/lib/env";
import { stripeClient, stripeCustomerFor } from "@/lib/stripe-customer";
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
  jobId: string;
  customerId: string;
  proposalId?: string | null;
  kind: PlanKind;
  totalCents: number;
  depositCents?: number;
  instalments?: number;
  interval?: Interval;
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
        job_id: input.jobId,
        proposal_id: input.proposalId ?? null,
        customer_id: input.customerId,
        kind: input.kind,
        total_cents: input.totalCents,
        deposit_cents: input.depositCents ?? 0,
        instalments: input.kind === "instalments" ? input.instalments ?? null : null,
        interval: input.interval ?? null,
        created_by: profile.id,
      })
      .select("id")
      .maybeSingle();

    if (error || !plan) return { ok: false, message: describeDbError(error) };

    const schedule = buildSchedule(input);
    const today = new Date();
    const { error: scheduleError } = await supabase.from("payment_plan_instalments").insert(
      schedule.map((item) => ({
        plan_id: plan.id,
        number: item.number,
        amount_cents: item.amountCents,
        due_on: addDays(today, item.dueInDays),
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
  jobId: string;
  customerId: string;
  planId?: string | null;
  instalmentId?: string | null;
  amountCents: number;
  method: "cash" | "check" | "other";
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

    const { error } = await supabase.from("payments").insert({
      organization_id: organizationId,
      customer_id: input.customerId,
      job_id: input.jobId,
      plan_id: input.planId ?? null,
      instalment_id: input.instalmentId ?? null,
      amount_cents: input.amountCents,
      method: input.method,
      note: input.note?.trim() || null,
      recorded_by: profile.id,
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

/** Closes a plan once nothing is left owing on it. */
async function settleIfPaidOff(planId: string): Promise<void> {
  const admin = createAdminClient();

  const { data: outstanding } = await admin
    .from("payment_plan_instalments")
    .select("id")
    .eq("plan_id", planId)
    .eq("status", "due")
    .limit(1);

  await admin
    .from("payment_plans")
    .update({ status: outstanding && outstanding.length > 0 ? "active" : "settled" })
    .eq("id", planId);
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

function refresh(jobId: string) {
  revalidatePath(`/jobs/${jobId}`);
  revalidatePath("/admin/payments");
}
