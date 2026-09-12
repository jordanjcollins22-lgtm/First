"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { isStripeConfigured } from "@/lib/env";
import { stripeClient } from "@/lib/stripe-customer";
import { outboundBaseUrl } from "@/lib/base-url";
import { absolute } from "@/lib/proposal-flow";
import { checkTipAmount, dollars, tipOptions, type TipOption, type TipStatus } from "@/lib/tips";

/**
 * The client's half of a tip: what they see, what they pay, and saying no.
 *
 * Opened by somebody with no account, from a link handed over at the door, so
 * everything here runs on the admin client and the token in the URL is the
 * whole of the access. There is nothing to leak by design: the page reads a
 * job's address and what it came to, both of which the person who paid for it
 * knows better than we do, and it never touches another client's row.
 *
 * Declining is a first-class action rather than the absence of one. Somebody
 * who says no has told us something; somebody who closed the tab has not, and
 * a business that cannot tell them apart will read its own tipping rate wrong.
 */

export type TipFailed = { ok: false; message: string };
export type TipResult = { ok: true } | TipFailed;
/** A started payment always carries somewhere to send them. */
export type TipStarted = { ok: true; url: string } | TipFailed;

function describe(err: unknown): string {
  console.error("tip action failed:", err);
  return "Something went wrong on our end. Please try again.";
}

export interface TipAsk {
  token: string;
  status: TipStatus;
  businessName: string;
  address: string | null;
  /** What the job came to, for showing what the suggestions are a share of. */
  jobTotalLabel: string | null;
  options: TipOption[];
  /** What this business says about where a tip goes. */
  note: string | null;
  /** What was paid, on a link somebody comes back to. */
  paidLabel: string | null;
  /** Whether a card can actually be charged right now. */
  canCharge: boolean;
}

/** What the client sees, by their token. */
export async function tipByToken(token: string): Promise<TipAsk | null> {
  try {
    const admin = createAdminClient();
    const { data: tip } = await admin
      .from("job_tips")
      .select("token, status, amount_cents, job_total_cents, job_id, organization_id")
      .eq("token", token)
      .maybeSingle();
    if (!tip) return null;

    const [{ data: org }, { data: job }] = await Promise.all([
      admin
        .from("organizations")
        .select("name, tips_enabled, tips_note")
        .eq("id", tip.organization_id)
        .maybeSingle(),
      admin
        .from("jobs")
        .select("id, property:properties(address)")
        .eq("id", tip.job_id)
        .maybeSingle(),
    ]);

    // Switched off since the link went out. A dead page rather than a live
    // one that cannot take the money.
    if (org && org.tips_enabled === false && tip.status !== "paid") return null;

    const property = (job as unknown as { property: { address: string } | null } | null)?.property;

    return {
      token: tip.token,
      status: tip.status as TipStatus,
      businessName: org?.name ?? "your crew",
      address: property?.address ?? null,
      jobTotalLabel: tip.job_total_cents ? dollars(tip.job_total_cents) : null,
      options: tipOptions(tip.job_total_cents ?? 0),
      note: org?.tips_note ?? null,
      paidLabel: tip.status === "paid" && tip.amount_cents ? dollars(tip.amount_cents) : null,
      canCharge: isStripeConfigured,
    };
  } catch (err) {
    console.error("couldn't read a tip ask:", err);
    return null;
  }
}

/**
 * Open the card form for an amount they chose.
 *
 * The row is marked unpaid and given the session before the client is sent to
 * Stripe, because Stripe needs somewhere to come back to. Nothing about an
 * unpaid row claims any money arrived.
 */
export async function startTip(input: {
  token: string;
  amount: string | number;
  message: string;
}): Promise<TipStarted> {
  try {
    const checked = checkTipAmount(input.amount);
    if (!checked.ok) return { ok: false, message: checked.message };

    if (!isStripeConfigured) {
      return { ok: false, message: "Card payments aren't switched on yet. Tell the crew in person." };
    }

    const admin = createAdminClient();
    const { data: tip } = await admin
      .from("job_tips")
      .select("id, status, organization_id")
      .eq("token", input.token)
      .maybeSingle();
    if (!tip) return { ok: false, message: "This link isn't active." };
    if (tip.status === "paid") return { ok: false, message: "This one is already settled. Thank you." };

    const { data: org } = await admin
      .from("organizations")
      .select("name, tips_enabled")
      .eq("id", tip.organization_id)
      .maybeSingle();
    if (org?.tips_enabled === false) return { ok: false, message: "This link isn't active." };

    const baseUrl = await outboundBaseUrl();
    if (!baseUrl) return { ok: false, message: "Couldn't start that payment. Try again." };

    const note = input.message.trim().slice(0, 500);
    const stripe = stripeClient();
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [
        {
          price_data: {
            currency: "usd",
            unit_amount: checked.cents,
            product_data: {
              name: `Tip for the ${org?.name ?? "crew"} team`,
              description: "Thank you — this goes to the people who did the work.",
            },
          },
          quantity: 1,
        },
      ],
      success_url: `${absolute(baseUrl, `/tip/${input.token}`)}?paid=1`,
      cancel_url: absolute(baseUrl, `/tip/${input.token}`),
      metadata: { job_tip_id: tip.id, organization_id: tip.organization_id },
    });

    if (!session.url) return { ok: false, message: "Couldn't open the card form. Try again." };

    await admin
      .from("job_tips")
      .update({
        status: "unpaid",
        amount_cents: checked.cents,
        message: note || null,
        checkout_session_id: session.id,
        declined_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", tip.id);

    return { ok: true, url: session.url };
  } catch (err) {
    return { ok: false, message: describe(err) };
  }
}

/**
 * Mark a tip paid.
 *
 * Called two ways on purpose. The webhook calls it, because a client who
 * closes the tab on the receipt has still paid; and the page they land back on
 * calls it, because a webhook thirty seconds behind should not leave somebody
 * looking at a page still asking them for money they just sent.
 *
 * Idempotent: whichever gets there first writes the row, and the second finds
 * a paid one and does nothing.
 */
export async function settleTip(tipId: string): Promise<void> {
  const admin = createAdminClient();
  const { data: tip } = await admin
    .from("job_tips")
    .select("id, status, checkout_session_id")
    .eq("id", tipId)
    .maybeSingle();

  if (!tip || tip.status === "paid" || !tip.checkout_session_id) return;
  if (!isStripeConfigured) return;

  try {
    const stripe = stripeClient();
    const session = await stripe.checkout.sessions.retrieve(tip.checkout_session_id);
    if (session.payment_status !== "paid") return;

    await admin
      .from("job_tips")
      .update({
        status: "paid",
        // What Stripe says arrived, not what we asked for. A client who edited
        // the amount in the sheet gets credited what they actually sent.
        amount_cents: session.amount_total ?? undefined,
        paid_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", tip.id)
      .neq("status", "paid");
  } catch (err) {
    console.error("couldn't settle a tip:", err);
  }
}

/** Settle by token, for the page the client lands back on. */
export async function settleTipByToken(token: string): Promise<void> {
  const admin = createAdminClient();
  const { data: tip } = await admin.from("job_tips").select("id").eq("token", token).maybeSingle();
  if (tip) await settleTip(tip.id);
}

/**
 * They said no.
 *
 * Recorded, because it is an answer. A business that counts silence and
 * refusal as the same thing reads its own tipping rate wrong, and the
 * conclusion it draws from that is usually to ask harder.
 *
 * Reversible on purpose: somebody who says no and changes their mind on the
 * way back inside should be able to.
 */
export async function declineTip(token: string): Promise<TipResult> {
  try {
    const admin = createAdminClient();
    const { data: tip } = await admin
      .from("job_tips")
      .select("id, status")
      .eq("token", token)
      .maybeSingle();
    if (!tip) return { ok: false, message: "This link isn't active." };
    if (tip.status === "paid") return { ok: true };

    await admin
      .from("job_tips")
      .update({
        status: "declined",
        declined_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", tip.id);

    return { ok: true };
  } catch (err) {
    return { ok: false, message: describe(err) };
  }
}
