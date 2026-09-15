"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { isStripeConfigured } from "@/lib/env";
import { stripeClient } from "@/lib/stripe-customer";
import { outboundBaseUrl } from "@/lib/base-url";
import { absolute } from "@/lib/proposal-flow";
import { dollars, passExpiry } from "@/lib/community-groups";
import { makeCode } from "@/lib/outreach-links";

/**
 * A local business paying to post in one of our groups.
 *
 * This is the other half of the rule. Declining a business post is a rule;
 * declining it with somewhere to pay is a product, and the group stops being
 * a cost.
 *
 * Opened by somebody with no account, from a link in the decline message, so
 * everything here runs on the admin client and the group id in the URL is the
 * whole of the access. There is nothing to leak: a group's name, its area and
 * what a post costs are what the page exists to say.
 */

export type PassResult<T = Record<string, never>> = ({ ok: true } & T) | { ok: false; message: string };

function describe(err: unknown): string {
  console.error("group pass action failed:", err);
  return "Something went wrong on our end. Please try again.";
}

/**
 * Take their details and open the card form.
 *
 * The pass is written before the payment, unpaid, because Stripe has to be
 * given somewhere to come back to. Nothing about an unpaid pass entitles
 * anybody to anything — `passIsGood` only says yes to a paid one that has not
 * lapsed.
 */
export async function buyGroupPass(input: {
  groupId: string;
  businessName: string;
  contactName: string;
  email: string;
  phone: string;
}): Promise<PassResult<{ url: string }>> {
  try {
    const businessName = input.businessName.trim();
    if (!businessName) return { ok: false, message: "Tell us the business name." };
    if (!input.email.trim()) return { ok: false, message: "We need an email to send the code to." };

    const admin = createAdminClient();
    const { data: group } = await admin
      .from("community_groups")
      .select("id, organization_id, name, business_post_cents, pass_days, archived_at")
      .eq("id", input.groupId)
      .maybeSingle();

    if (!group || group.archived_at) return { ok: false, message: "That group isn't taking business posts." };
    if (group.business_post_cents == null) {
      return { ok: false, message: "This group doesn't sell business posts." };
    }
    if (!isStripeConfigured) {
      return { ok: false, message: "Card payments aren't switched on yet. Message the page and we'll sort it." };
    }

    const baseUrl = await outboundBaseUrl();
    if (!baseUrl) return { ok: false, message: "Couldn't start that payment. Message the page instead." };

    // Retried rather than failed on: the column is unique, so a clash is a
    // rejected insert and never two businesses holding one code.
    let code = makeCode();
    let passId: string | null = null;
    for (let attempt = 0; attempt < 5 && !passId; attempt += 1) {
      const { data, error } = await admin
        .from("group_post_passes")
        .insert({
          organization_id: group.organization_id,
          group_id: group.id,
          business_name: businessName.slice(0, 120),
          contact_name: input.contactName.trim().slice(0, 120) || null,
          email: input.email.trim().slice(0, 200),
          phone: input.phone.trim().slice(0, 40) || null,
          code,
          amount_cents: group.business_post_cents,
          status: "unpaid",
        })
        .select("id")
        .single();

      if (data) {
        passId = data.id;
        break;
      }
      if (error && !/duplicate|unique/i.test(error.message)) {
        return { ok: false, message: describe(error) };
      }
      code = makeCode();
    }

    if (!passId) return { ok: false, message: "Couldn't start that. Try once more." };

    const days = group.pass_days;
    const stripe = stripeClient();
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      customer_email: input.email.trim() || undefined,
      customer_creation: "always",
      line_items: [
        {
          price_data: {
            currency: "usd",
            unit_amount: group.business_post_cents,
            product_data: {
              name: `Business post in ${group.name}`,
              description: `One post, good for ${days} day${days === 1 ? "" : "s"}.`,
            },
          },
          quantity: 1,
        },
      ],
      success_url: `${absolute(baseUrl, `/promote/pass/${code}`)}?paid=1`,
      cancel_url: absolute(baseUrl, `/promote/${group.id}`),
      metadata: {
        group_pass_id: passId,
        organization_id: group.organization_id,
      },
    });

    if (!session.url) return { ok: false, message: "Couldn't open the card form. Try again." };

    await admin.from("group_post_passes").update({ checkout_session_id: session.id }).eq("id", passId);
    return { ok: true, url: session.url };
  } catch (err) {
    return { ok: false, message: describe(err) };
  }
}

/**
 * Mark a pass paid.
 *
 * Called two ways on purpose. The webhook calls it, because a business that
 * closes the tab on the receipt has still paid; and the page they land on
 * calls it, because a webhook that has not arrived yet should not leave
 * somebody staring at "not paid" thirty seconds after paying.
 *
 * Idempotent. Whichever gets there first sets the expiry, and the second sees
 * a paid row and does nothing.
 */
export async function settleGroupPass(passId: string): Promise<void> {
  const admin = createAdminClient();
  const { data: pass } = await admin
    .from("group_post_passes")
    .select("id, group_id, status, checkout_session_id")
    .eq("id", passId)
    .maybeSingle();

  if (!pass || pass.status !== "unpaid" || !pass.checkout_session_id) return;
  if (!isStripeConfigured) return;

  try {
    const stripe = stripeClient();
    const session = await stripe.checkout.sessions.retrieve(pass.checkout_session_id);
    if (session.payment_status !== "paid") return;

    const { data: group } = await admin
      .from("community_groups")
      .select("pass_days")
      .eq("id", pass.group_id)
      .maybeSingle();

    const paidAt = new Date();
    await admin
      .from("group_post_passes")
      .update({
        status: "paid",
        paid_at: paidAt.toISOString(),
        expires_at: passExpiry(paidAt, group?.pass_days ?? 30).toISOString(),
      })
      .eq("id", pass.id)
      .eq("status", "unpaid");
  } catch (err) {
    console.error("couldn't settle group pass:", err);
  }
}

/** What the business sees on their own pass, by its code. */
export async function passByCode(code: string): Promise<
  | {
      ok: true;
      code: string;
      businessName: string;
      groupName: string;
      groupUrl: string | null;
      status: string;
      amountLabel: string;
      expiresAt: string | null;
    }
  | { ok: false; message: string }
> {
  try {
    const admin = createAdminClient();
    const { data: pass } = await admin
      .from("group_post_passes")
      .select("id, group_id, business_name, code, amount_cents, status, expires_at")
      .eq("code", code)
      .maybeSingle();

    if (!pass) return { ok: false, message: "That link isn't valid." };
    await settleGroupPass(pass.id);

    const [{ data: fresh }, { data: group }] = await Promise.all([
      admin.from("group_post_passes").select("status, expires_at").eq("id", pass.id).maybeSingle(),
      admin.from("community_groups").select("name, external_url").eq("id", pass.group_id).maybeSingle(),
    ]);

    return {
      ok: true,
      code: pass.code,
      businessName: pass.business_name,
      groupName: group?.name ?? "the group",
      groupUrl: group?.external_url ?? null,
      status: fresh?.status ?? pass.status,
      amountLabel: dollars(pass.amount_cents),
      expiresAt: fresh?.expires_at ?? pass.expires_at,
    };
  } catch (err) {
    return { ok: false, message: describe(err) };
  }
}
