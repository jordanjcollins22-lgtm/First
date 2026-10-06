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
import { headers } from "next/headers";
import { notifyTeamMember } from "@/lib/notifications";
import { fbcFromClickId, metaEndpoint, metaEvent, type MetaEventInput } from "@/lib/meta-capi";
import { dayLabel, isOpenDay, MOW_DAYS_AHEAD, openMowDays, type MowDay } from "@/lib/mow-days";
import { paidAlert, requestAlert } from "@/lib/mow-messages";
import { dateKeyIn } from "@/lib/time-zone";

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
  const query = admin.from("organizations").select("id, name, slug, business_phone, quick_mow_alerts, mows_per_day");
  const { data } = orgSlug ? await query.eq("slug", orgSlug).maybeSingle() : await query.eq("id", DEFAULT_ORG).maybeSingle();
  return {
    admin,
    org: data as { id: string; name: string; slug: string | null; business_phone: string | null; quick_mow_alerts: boolean; mows_per_day: number } | null,
  };
}

function fail(err: unknown): { ok: false; message: string } {
  log.error("mow.action_failed", { error: err instanceof Error ? err.message : String(err) });
  return { ok: false, message: "Something went wrong on our end. Please try again." };
}

/** Who is asking, for matching the sale to the ad on Meta's side. */
async function requester(): Promise<{ ip: string | null; userAgent: string | null }> {
  try {
    const list = await headers();
    return { ip: list.get("x-forwarded-for")?.split(",")[0]?.trim() || null, userAgent: list.get("user-agent")?.slice(0, 400) || null };
  } catch {
    return { ip: null, userAgent: null };
  }
}

/**
 * Texts the account managers and owners, within seconds, when somebody asks
 * for a price or pays: speed to lead. Only when quick mow alerts are switched
 * on, and only through the app's own team alerts, which respect each
 * person's own settings and fall back to email.
 */
async function alertTeam(admin: ReturnType<typeof createAdminClient>, orgId: string, body: string, dedupeKey: string): Promise<void> {
  const { data: org } = await admin.from("organizations").select("quick_mow_alerts").eq("id", orgId).maybeSingle();
  if (!org?.quick_mow_alerts) return;
  const { data: people } = await admin
    .from("profile_roles")
    .select("profile_id, role_name, profiles!inner(organization_id)")
    .in("role_name", ["account manager", "admin", "owner"])
    .eq("profiles.organization_id", orgId);
  const ids = [...new Set((people ?? []).map((p) => (p as { profile_id: string }).profile_id))];
  await Promise.all(ids.map((id) => notifyTeamMember(id, "proposal_responses", body, { dedupeKey: `${dedupeKey}:${id}` }).catch(() => false)));
}

/** Sends one event to Meta. Off, quietly, until the pixel and token are set. Never in the way of the sale. */
async function reportToMeta(input: MetaEventInput): Promise<boolean> {
  const endpoint = metaEndpoint(process.env.META_PIXEL_ID, process.env.META_CAPI_TOKEN);
  if (!endpoint) return false;
  try {
    const testCode = process.env.META_TEST_EVENT_CODE;
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ data: [metaEvent(input)], ...(testCode ? { test_event_code: testCode } : {}) }),
      signal: AbortSignal.timeout(6000),
    });
    if (!response.ok) log.warn("mow.meta_rejected", { status: response.status, event: input.name });
    return response.ok;
  } catch (err) {
    log.warn("mow.meta_failed", { event: input.name, error: err instanceof Error ? err.message : String(err) });
    return false;
  }
}

/** Days a first mow can still be booked: tomorrow on, never a full day. */
async function openDaysFor(admin: ReturnType<typeof createAdminClient>, orgId: string, perDay: number): Promise<MowDay[]> {
  const now = new Date();
  const from = dateKeyIn(new Date(now.getTime() + 86_400_000));
  const to = dateKeyIn(new Date(now.getTime() + (MOW_DAYS_AHEAD + 1) * 86_400_000));
  const { data } = await admin
    .from("job_work_sessions")
    .select("starts_on, status, jobs!inner(pipeline)")
    .eq("organization_id", orgId)
    .eq("jobs.pipeline", "quick_mow")
    .neq("status", "cancelled")
    .gte("starts_on", from)
    .lte("starts_on", to);
  const booked: Record<string, number> = {};
  for (const row of (data ?? []) as { starts_on: string }[]) booked[row.starts_on] = (booked[row.starts_on] ?? 0) + 1;
  return openMowDays(now, booked, perDay);
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
      /** Days they can pick for their first mow. */
      days: MowDay[];
    }
  | { ok: false; message: string };

export type AreaCheck =
  | {
      ok: true;
      /** Yes when the county has a lot at the address. Null when the county map couldn't be reached: let them through. */
      inArea: boolean | null;
      lat: number | null;
      lng: number | null;
      /** Their lot from the county, to show them the property we just said yes to. */
      lot: LotData | null;
    }
  | { ok: false; message: string };

/**
 * Whether we mow at an address: it is in our area when Harford County has a
 * lot there. Nothing is saved; this is the first thing anybody does on the
 * page, before they have told us who they are. When the county's map can't
 * be reached the answer is "don't know", and they are let through rather
 * than turned away over somebody else's outage.
 */
export async function checkServiceArea(input: {
  address: string;
  lat?: number | null;
  lng?: number | null;
  orgSlug?: string | null;
  rec?: string | null;
}): Promise<AreaCheck> {
  try {
    const address = input.address.trim();
    if (address.length < 6) return { ok: false, message: "Type your full street address." };
    const placed = await placeAddress(address, input.lat, input.lng);
    if (!placed) return { ok: false, message: "We couldn't find that address. Check it and try again, or pick one from the list." };
    let inArea: boolean | null;
    let lot: LotData | null = null;
    try {
      lot = await fetchLotFromCounty(placed.lat, placed.lng, address);
      inArea = lot != null;
    } catch {
      inArea = null;
    }
    // Counted for the funnel scoreboard: whether it was in the area and which link brought them, nothing else.
    const { admin, org } = await business(input.orgSlug ?? null);
    if (org) {
      const rec = input.rec && /^[a-z0-9]{4,12}$/.test(input.rec) ? input.rec : null;
      await admin.from("mow_area_checks").insert({ organization_id: org.id, in_area: inArea, referral_code: rec }).then(undefined, () => {});
    }
    log.info("mow.area_checked", { inArea });
    return { ok: true, inArea, lat: placed.lat, lng: placed.lng, lot };
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
  /** ?fbclid= from the ad link, and Meta's own browser cookie, when they came from an ad. */
  fbclid?: string | null;
  fbp?: string | null;
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
    const who = await requester();
    const fbc = fbcFromClickId(input.fbclid, new Date());
    const fbp = input.fbp && /^fb\.\d\.\d+\.\d+$/.test(input.fbp) ? input.fbp : null;

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
      ...(fbc ? { fbc } : {}),
      ...(fbp ? { fbp } : {}),
      client_ip: who.ip,
      client_user_agent: who.userAgent,
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

    if (!earlier) {
      // Speed to lead: the team hears about it now, while they are still on the page.
      await alertTeam(
        admin,
        org.id,
        requestAlert({ name, phone, address, price: price ? dollars(price.firstMowCents) : null }),
        `mow:request:${saved.data.id}`
      ).catch(() => {});
      // A qualified lead for Meta: in our area (the county has their lot) and gave their details.
      if (lot) {
        const base = (await outboundBaseUrl()) || "";
        const sent = await reportToMeta({
          name: "Lead",
          eventId: `${saved.data.id}:lead`,
          at: new Date(),
          sourceUrl: absolute(base, "/mow"),
          email,
          phone,
          fbc,
          fbp,
          ip: who.ip,
          userAgent: who.userAgent,
        });
        if (sent) await admin.from("mow_orders").update({ meta_lead_reported_at: new Date().toISOString() }).eq("id", saved.data.id);
      }
    }

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
      days: await openDaysFor(admin, org.id, org.mows_per_day ?? 18),
    };
  } catch (err) {
    return fail(err);
  }
}

export type StartResult = { ok: true; url: string } | { ok: false; message: string };

/** The size they settled on, priced here, and the card form opened for the order their details are under. */
export async function startMowOrder(input: { orderId: string; tier: string; day: string | null }): Promise<StartResult> {
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
    const { data: org } = await admin.from("organizations").select("mows_per_day").eq("id", order.organization_id).maybeSingle();
    const days = await openDaysFor(admin, order.organization_id, org?.mows_per_day ?? 18);
    // A day they can have, or none at all when every day is full: then the call finds them the first opening.
    if (days.length > 0 ? !input.day || !isOpenDay(input.day, days) : input.day !== null) {
      return { ok: false, message: "That day just filled up. Pick another day." };
    }
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
        mow_day: input.day ?? null,
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
              description: `${tier.label} at ${order.address}${input.day ? ` on ${dayLabel(input.day)}` : ""}. A team member will call shortly to confirm.`,
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
    .select(
      "id, organization_id, name, email, phone, address, lat, lng, tier, lawn_sqft, amount_cents, regular_cents, referral_code, status, checkout_session_id, mow_day, fbc, fbp, client_ip, client_user_agent"
    )
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

    // The day they picked, on the calendar. The call confirms it.
    if (filed.jobId && order.mow_day) {
      await admin
        .from("job_work_sessions")
        .insert({
          job_id: filed.jobId,
          organization_id: order.organization_id,
          starts_on: order.mow_day,
          ends_on: order.mow_day,
          status: "scheduled",
          purpose: "First mow, booked and paid online. Call to confirm.",
        })
        .then(undefined, (err: unknown) => log.error("mow.visit_failed", { orderId: order.id, error: String(err) }));
    }

    const day = order.mow_day ? dayLabel(order.mow_day) : null;
    await alertTeam(
      admin,
      order.organization_id,
      paidAlert({ name: order.name, phone: order.phone, address: order.address, paid: dollars(order.amount_cents ?? 0), day }),
      `mow:paid:${order.id}`
    ).catch(() => {});

    // A buyer, for Meta: the event the ads should learn from.
    const base = (await outboundBaseUrl()) || "";
    const reported = await reportToMeta({
      name: "Purchase",
      eventId: `${order.id}:purchase`,
      at: new Date(),
      sourceUrl: absolute(base, "/mow"),
      email: order.email,
      phone: order.phone,
      fbc: order.fbc,
      fbp: order.fbp,
      ip: order.client_ip,
      userAgent: order.client_user_agent,
      valueCents: order.amount_cents,
    });
    if (reported) await admin.from("mow_orders").update({ meta_purchase_reported_at: new Date().toISOString() }).eq("id", order.id);
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
  day: string | null;
} | null> {
  if (!/^[0-9a-f-]{36}$/.test(orderId)) return null;
  const admin = createAdminClient();
  const { data } = await admin.from("mow_orders").select("name, address, tier, amount_cents, status, organization_id, mow_day").eq("id", orderId).maybeSingle();
  if (!data) return null;
  const { data: org } = await admin.from("organizations").select("business_phone").eq("id", data.organization_id).maybeSingle();
  return {
    firstName: data.name.split(/\s+/)[0] ?? data.name,
    address: data.address,
    tierLabel: (data.tier && tierByKey(data.tier)?.label) || "Lawn mow",
    paid: dollars(data.amount_cents ?? 0),
    isPaid: data.status === "paid",
    phone: (org as { business_phone?: string | null } | null)?.business_phone ?? null,
    day: data.mow_day ? dayLabel(data.mow_day) : null,
  };
}
