"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { isStripeConfigured } from "@/lib/env";
import { stripeClient } from "@/lib/stripe-customer";
import { outboundBaseUrl } from "@/lib/base-url";
import { absolute } from "@/lib/proposal-flow";
import { findDuplicateCustomer, findDuplicateProperty, mergeableFields } from "@/lib/dedupe";
import { ensureClientAccount } from "@/lib/data/client-accounts";
import { lookupAddress } from "@/lib/mapbox-geocoding";
import { fetchLotFromCounty } from "@/lib/data/lot-map";
import type { LotData } from "@/lib/lot-map";
import { dollars, estimateLawn, firstMowPrice, FIRST_MOW_DISCOUNT, MOW_TIERS, tierByKey, tierFor } from "@/lib/mow-price";
import { log, maskEmail } from "@/lib/log";

/**
 * The quick mow page: an address, a price, a card. Bought by somebody with
 * no account, so everything runs on the service role, and the price is
 * always worked out here from the server's own tiers; the browser shows a
 * price, it never names one.
 *
 * Nothing downstream is made until the money lands. Then the client, their
 * property and a sold job are created, and the order goes on the team's list
 * to be called within 24 hours to set the day.
 */

const DEFAULT_ORG = "00000000-0000-0000-0000-000000000001";

async function business(orgSlug: string | null) {
  const admin = createAdminClient();
  const query = admin.from("organizations").select("id, name, slug, business_phone");
  const { data } = orgSlug ? await query.eq("slug", orgSlug).maybeSingle() : await query.eq("id", DEFAULT_ORG).maybeSingle();
  return { admin, org: data as { id: string; name: string; slug: string | null; business_phone: string | null } | null };
}

function fail(err: unknown): { ok: false; message: string } {
  log.error("mow.action_failed", { error: err instanceof Error ? err.message : String(err) });
  return { ok: false, message: "Something went wrong on our end. Please try again." };
}

/** Coordinates for the address: the suggestion they picked, or a lookup of what they typed. */
async function placeAddress(address: string, lat?: number | null, lng?: number | null): Promise<{ lat: number; lng: number } | null> {
  if (Number.isFinite(lat) && Number.isFinite(lng)) return { lat: Number(lat), lng: Number(lng) };
  try {
    const lookup = await lookupAddress(address, undefined, { autocomplete: false });
    const first = lookup.ok ? lookup.suggestions[0] : null;
    return first ? { lat: first.lat, lng: first.lng } : null;
  } catch {
    return null;
  }
}

export interface TierOption {
  key: string;
  label: string;
  regular: string;
  firstMow: string;
}

const OPTIONS: TierOption[] = MOW_TIERS.map((tier) => {
  const price = firstMowPrice(tier);
  return { key: tier.key, label: tier.label, regular: dollars(price.regularCents), firstMow: dollars(price.firstMowCents) };
});

export type MowQuote =
  | {
      ok: true;
      /** The order their details were saved under. Paying finishes this one. */
      orderId: string;
      /** The lot from the county, for the picture. Null when the county had none for this address. */
      lot: LotData | null;
      lotSqft: number | null;
      lawnSqft: number | null;
      /** The tier the lawn came out in. Null past an acre, or with no lot to measure. */
      tier: string | null;
      overAcre: boolean;
      tiers: TierOption[];
      discountPercent: number;
    }
  | { ok: false; message: string };

export type AreaCheck =
  | {
      ok: true;
      /** Yes when the county has a lot at the address. Null when the county map couldn't be reached: let them through. */
      inArea: boolean | null;
      lat: number | null;
      lng: number | null;
    }
  | { ok: false; message: string };

/**
 * Whether we mow at an address: it is in our area when Harford County has a
 * lot there. Nothing is saved; this is the first thing anybody does on the
 * page, before they have told us who they are. When the county's map can't
 * be reached the answer is "don't know", and they are let through rather
 * than turned away over somebody else's outage.
 */
export async function checkServiceArea(input: { address: string; lat?: number | null; lng?: number | null }): Promise<AreaCheck> {
  try {
    const address = input.address.trim();
    if (address.length < 6) return { ok: false, message: "Type your full street address." };
    const placed = await placeAddress(address, input.lat, input.lng);
    if (!placed) return { ok: false, message: "We couldn't find that address. Check it and try again, or pick one from the list." };
    let inArea: boolean | null;
    try {
      inArea = (await fetchLotFromCounty(placed.lat, placed.lng, address)) != null;
    } catch {
      inArea = null;
    }
    log.info("mow.area_checked", { inArea });
    return { ok: true, inArea, lat: placed.lat, lng: placed.lng };
  } catch (err) {
    return fail(err);
  }
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function contactProblem(name: string, email: string, phone: string, address: string): string | null {
  if (address.length < 6) return "Type your full street address.";
  if (name.length < 2) return "We need your name.";
  if (phone.replace(/\D/g, "").length < 10) return "We need a phone number with area code.";
  if (!EMAIL.test(email)) return "That email doesn't look right.";
  return null;
}

/**
 * Their details, saved, then their lot, their lawn's size and its price.
 *
 * The details are kept before the price is shown, so somebody who sees a
 * price and leaves is still somebody to call. Asking again with the same
 * email and address picks up the same order rather than making another.
 * Never refuses for want of a lot: they can pick a size themselves.
 */
export async function mowQuote(input: {
  orgSlug: string | null;
  name: string;
  email: string;
  phone: string;
  address: string;
  lat?: number | null;
  lng?: number | null;
  rec: string | null;
}): Promise<MowQuote> {
  try {
    const name = input.name.trim().slice(0, 120);
    const email = input.email.trim().toLowerCase().slice(0, 200);
    const phone = input.phone.trim().slice(0, 40);
    const address = input.address.trim().slice(0, 300);
    const problem = contactProblem(name, email, phone, address);
    if (problem) return { ok: false, message: problem };

    const { admin, org } = await business(input.orgSlug);
    if (!org) return { ok: false, message: "We're not taking mows from this link right now." };

    const placed = await placeAddress(address, input.lat, input.lng);
    const lot = placed ? await fetchLotFromCounty(placed.lat, placed.lng, address).catch(() => null) : null;
    const estimate = estimateLawn(lot);
    const tier = estimate ? tierFor(estimate.lawnSqft) : null;
    const price = tier ? firstMowPrice(tier) : null;
    const rec = input.rec && /^[a-z0-9]{4,12}$/.test(input.rec) ? input.rec : null;

    const row = {
      name,
      email,
      phone,
      address,
      lat: placed?.lat ?? null,
      lng: placed?.lng ?? null,
      lot_sqft: estimate?.lotSqft ?? null,
      lawn_sqft: estimate?.lawnSqft ?? null,
      estimated_tier: tier?.key ?? null,
      tier: tier?.key ?? null,
      tier_moved: false,
      regular_cents: price?.regularCents ?? null,
      discount_cents: price?.discountCents ?? 0,
      amount_cents: price?.firstMowCents ?? null,
      referral_code: rec,
      updated_at: new Date().toISOString(),
    };

    const { data: earlier } = await admin
      .from("mow_orders")
      .select("id")
      .eq("organization_id", org.id)
      .eq("status", "unpaid")
      .ilike("email", email)
      .ilike("address", address)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const saved = earlier
      ? await admin.from("mow_orders").update(row).eq("id", earlier.id).select("id").single()
      : await admin.from("mow_orders").insert({ ...row, organization_id: org.id, status: "unpaid" }).select("id").single();
    if (saved.error || !saved.data) return fail(saved.error);

    // Into the system as a request: the client, their property and a job on
    // the quick mow pipeline. Never in the way of the price: if filing fails,
    // the order still has their details and paying files it again.
    await fileRequest(admin, saved.data.id).catch((err) =>
      log.error("mow.request_failed", { orderId: saved.data.id, error: err instanceof Error ? err.message : String(err) })
    );

    log.info("mow.quoted", { orderId: saved.data.id, tier: tier?.key ?? null, lot: Boolean(lot), email: maskEmail(email), rec });
    return {
      ok: true,
      orderId: saved.data.id,
      lot,
      lotSqft: estimate?.lotSqft ?? null,
      lawnSqft: estimate?.lawnSqft ?? null,
      tier: tier?.key ?? null,
      overAcre: Boolean(estimate && !tier),
      tiers: OPTIONS,
      discountPercent: Math.round(FIRST_MOW_DISCOUNT * 100),
    };
  } catch (err) {
    return fail(err);
  }
}

export type StartResult = { ok: true; url: string } | { ok: false; message: string };

/** The size they settled on, priced here, and the card form opened for the order their details are under. */
export async function startMowOrder(input: { orderId: string; tier: string }): Promise<StartResult> {
  try {
    if (!/^[0-9a-f-]{36}$/.test(input.orderId)) return { ok: false, message: "Start again from your address." };
    const tier = tierByKey(input.tier);
    if (!tier) return { ok: false, message: "Pick your lawn size." };
    if (!isStripeConfigured) return { ok: false, message: "Card payments aren't switched on yet. Give us a call and we'll book you in." };

    const admin = createAdminClient();
    const { data: order } = await admin
      .from("mow_orders")
      .select("id, organization_id, email, address, status, estimated_tier, referral_code")
      .eq("id", input.orderId)
      .maybeSingle();
    if (!order) return { ok: false, message: "Start again from your address." };
    if (order.status !== "unpaid") return { ok: false, message: "That mow is already paid for." };
    const baseUrl = await outboundBaseUrl();
    if (!baseUrl) return { ok: false, message: "Couldn't start that payment. Try again." };

    const price = firstMowPrice(tier);
    const { error } = await admin
      .from("mow_orders")
      .update({
        tier: tier.key,
        tier_moved: order.estimated_tier !== tier.key,
        regular_cents: price.regularCents,
        discount_cents: price.discountCents,
        amount_cents: price.firstMowCents,
        updated_at: new Date().toISOString(),
      })
      .eq("id", order.id)
      .eq("status", "unpaid");
    if (error) return fail(error);

    const session = await stripeClient().checkout.sessions.create({
      mode: "payment",
      customer_email: order.email,
      line_items: [
        {
          price_data: {
            currency: "usd",
            unit_amount: price.firstMowCents,
            product_data: {
              name: `First lawn mow, ${Math.round(FIRST_MOW_DISCOUNT * 100)}% off`,
              description: `${tier.label} at ${order.address}. A team member will call within 24 hours to set your day.`,
            },
          },
          quantity: 1,
        },
      ],
      success_url: `${absolute(baseUrl, `/mow/done/${order.id}`)}?paid=1`,
      cancel_url: absolute(baseUrl, order.referral_code ? `/mow?rec=${order.referral_code}` : "/mow"),
      metadata: { mow_order_id: order.id, organization_id: order.organization_id },
    });
    if (!session.url) return { ok: false, message: "Couldn't open the card form. Try again." };

    await admin.from("mow_orders").update({ checkout_session_id: session.id, updated_at: new Date().toISOString() }).eq("id", order.id);
    log.info("mow.checkout_started", { orderId: order.id, tier: tier.key });
    return { ok: true, url: session.url };
  } catch (err) {
    return fail(err);
  }
}

/**
 * The money landed: the request's job becomes sold work, once.
 * Called from the Stripe webhook and from the page they land on, whichever
 * is first; the status claim stops the second from doing it again.
 */
export async function settleMowOrder(orderId: string): Promise<void> {
  const admin = createAdminClient();
  const { data: order } = await admin
    .from("mow_orders")
    .select("id, organization_id, name, email, phone, address, lat, lng, tier, lawn_sqft, amount_cents, regular_cents, referral_code, status, checkout_session_id")
    .eq("id", orderId)
    .maybeSingle();
  if (!order || order.status !== "unpaid" || !order.checkout_session_id || !isStripeConfigured) return;

  try {
    const session = await stripeClient().checkout.sessions.retrieve(order.checkout_session_id);
    if (session.payment_status !== "paid") return;

    const now = new Date().toISOString();
    const { data: claimed } = await admin
      .from("mow_orders")
      .update({ status: "paid", paid_at: now, updated_at: now })
      .eq("id", order.id)
      .eq("status", "unpaid")
      .select("id")
      .maybeSingle();
    if (!claimed) return;

    // The request's own client and job, made now if filing it at the price failed.
    const filed = await fileRequest(admin, order.id);
    if (filed.jobId) {
      const tier = order.tier ? tierByKey(order.tier) : null;
      await admin
        .from("jobs")
        .update({
          name: "Lawn mow, first visit",
          status: "approved",
          client_notes:
            `Paid ${dollars(order.amount_cents ?? 0)} for a first mow (${tier?.label ?? order.tier}, regular ${dollars(order.regular_cents ?? 0)}, ` +
            `${Math.round(FIRST_MOW_DISCOUNT * 100)}% off). ` +
            (order.lawn_sqft ? `Lawn about ${order.lawn_sqft.toLocaleString("en-US")} sq ft from the county lot. ` : "") +
            "Bought on the quick mow page. Call within 24 hours of payment to set the day.",
        })
        .eq("id", filed.jobId);
    }
    if (filed.customerId) await ensureClientAccount({ customerId: filed.customerId, email: order.email }).catch(() => null);
    log.info("mow.paid", { orderId: order.id, tier: order.tier, rec: order.referral_code });
  } catch (err) {
    log.error("mow.settle_failed", { orderId, error: err instanceof Error ? err.message : String(err) });
  }
}

type OrderRow = {
  organization_id: string;
  name: string;
  email: string;
  phone: string;
  address: string;
  lat: number | null;
  lng: number | null;
  tier: string | null;
  lawn_sqft: number | null;
  amount_cents: number | null;
  regular_cents: number | null;
  referral_code: string | null;
};

/** The client and property, matched to whoever we already know, as the salt orders do. */
async function placeClient(admin: ReturnType<typeof createAdminClient>, order: OrderRow): Promise<{ customerId: string; propertyId: string | null }> {
  const { data: existing } = await admin.from("customers").select("id, name, email, phone").eq("organization_id", order.organization_id);
  const duplicate = findDuplicateCustomer(existing ?? [], { name: order.name, email: order.email, phone: order.phone });

  let customerId: string;
  if (duplicate) {
    customerId = duplicate.id;
    const patch = mergeableFields(
      { name: duplicate.name ?? null, email: duplicate.email ?? null, phone: duplicate.phone ?? null },
      { name: order.name, email: order.email, phone: order.phone }
    );
    if (Object.keys(patch).length > 0) await admin.from("customers").update(patch).eq("id", customerId);
  } else {
    const { data: created, error } = await admin
      .from("customers")
      .insert({ organization_id: order.organization_id, name: order.name, email: order.email, phone: order.phone, source: "Quick mow page" })
      .select("id")
      .single();
    if (error || !created) throw error ?? new Error("no customer");
    customerId = created.id;
  }

  const { data: properties } = await admin.from("properties").select("id, address").eq("customer_id", customerId);
  const same = findDuplicateProperty(properties ?? [], order.address);
  if (same) return { customerId, propertyId: same.id };
  if (order.lat == null || order.lng == null) return { customerId, propertyId: null };

  const { data: property, error } = await admin
    .from("properties")
    .insert({ customer_id: customerId, address: order.address, lat: order.lat, lng: order.lng })
    .select("id")
    .single();
  if (error || !property) {
    log.error("mow.property_failed", { error: error?.message });
    return { customerId, propertyId: null };
  }
  return { customerId, propertyId: property.id };
}

/**
 * The request, filed: the client (matched to anybody we already know), their
 * property, and a job on the quick mow pipeline, linked back to the order.
 * Safe to call again; it only makes what is missing, and refreshes the job's
 * note with the latest price they saw.
 */
async function fileRequest(
  admin: ReturnType<typeof createAdminClient>,
  orderId: string
): Promise<{ customerId: string | null; jobId: string | null }> {
  const { data: order } = await admin
    .from("mow_orders")
    .select("id, organization_id, name, email, phone, address, lat, lng, tier, lawn_sqft, amount_cents, regular_cents, referral_code, status, customer_id, property_id, job_id")
    .eq("id", orderId)
    .maybeSingle();
  if (!order) return { customerId: null, jobId: null };

  let { customer_id: customerId, property_id: propertyId, job_id: jobId } = order;
  if (!customerId) {
    const placed = await placeClient(admin, order);
    customerId = placed.customerId;
    propertyId = placed.propertyId;
  }
  if (!jobId && propertyId) jobId = await openRequestJob(admin, order, propertyId);
  else if (jobId && order.status === "unpaid") {
    await admin.from("jobs").update({ client_notes: requestNote(order) }).eq("id", jobId).eq("status", "estimating");
  }

  if (customerId !== order.customer_id || propertyId !== order.property_id || jobId !== order.job_id) {
    await admin
      .from("mow_orders")
      .update({ customer_id: customerId, property_id: propertyId, job_id: jobId, updated_at: new Date().toISOString() })
      .eq("id", order.id);
  }
  return { customerId, jobId };
}

function requestNote(order: OrderRow): string {
  const tier = order.tier ? tierByKey(order.tier) : null;
  const price = tier ? `Saw ${tier.label.toLowerCase()} at ${dollars(firstMowPrice(tier).firstMowCents)} for the first mow (regular ${dollars(tier.cents)}). ` : "No instant price (no county lot, or more than an acre). ";
  return (
    "Quick mow request from the quick mow page. " +
    price +
    (order.lawn_sqft ? `Lawn about ${order.lawn_sqft.toLocaleString("en-US")} sq ft from the county lot. ` : "") +
    "Not paid yet: call them."
  );
}

/** A request, not yet sold: on the quick mow pipeline, credited to the link it came from. */
async function openRequestJob(admin: ReturnType<typeof createAdminClient>, order: OrderRow, propertyId: string): Promise<string | null> {
  const { data: job, error } = await admin
    .from("jobs")
    .insert({
      property_id: propertyId,
      name: "Quick mow request",
      status: "estimating",
      pipeline: "quick_mow",
      referral_code: order.referral_code,
      client_notes: requestNote(order),
    })
    .select("id")
    .maybeSingle();
  if (error) {
    log.error("mow.job_failed", { error: error.message });
    return null;
  }
  if (job) {
    const { data: service } = await admin
      .from("services")
      .select("service_type_id")
      .eq("organization_id", order.organization_id)
      .eq("service_type_id", "lawn-care")
      .maybeSingle();
    if (service) {
      await admin
        .from("job_requested_services")
        .insert({ job_id: job.id, organization_id: order.organization_id, service_type_id: service.service_type_id })
        .then(undefined, () => {});
    }
  }
  return job?.id ?? null;
}

/** What they see after paying. */
export async function mowOrderSummary(orderId: string): Promise<{
  firstName: string;
  address: string;
  tierLabel: string;
  paid: string;
  isPaid: boolean;
  phone: string | null;
} | null> {
  if (!/^[0-9a-f-]{36}$/.test(orderId)) return null;
  const admin = createAdminClient();
  const { data } = await admin.from("mow_orders").select("name, address, tier, amount_cents, status, organization_id").eq("id", orderId).maybeSingle();
  if (!data) return null;
  const { data: org } = await admin.from("organizations").select("business_phone").eq("id", data.organization_id).maybeSingle();
  return {
    firstName: data.name.split(/\s+/)[0] ?? data.name,
    address: data.address,
    tierLabel: (data.tier && tierByKey(data.tier)?.label) || "Lawn mow",
    paid: dollars(data.amount_cents ?? 0),
    isPaid: data.status === "paid",
    phone: (org as { business_phone?: string | null } | null)?.business_phone ?? null,
  };
}
