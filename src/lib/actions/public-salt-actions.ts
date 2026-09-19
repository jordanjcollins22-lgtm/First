"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { isStripeConfigured } from "@/lib/env";
import { stripeClient } from "@/lib/stripe-customer";
import { outboundBaseUrl } from "@/lib/base-url";
import { absolute } from "@/lib/proposal-flow";
import { findDuplicateCustomer, findDuplicateProperty, mergeableFields } from "@/lib/dedupe";
import { ensureClientAccount } from "@/lib/data/client-accounts";
import { lookupAddress } from "@/lib/mapbox-geocoding";
import {
  DEFAULT_SALT_SETTINGS,
  isSurface,
  MINIMUM_TREATMENTS,
  money,
  quoteOrder,
  SURFACE_LABEL,
  type SaltSettings,
  type Surface,
} from "@/lib/salt";

/**
 * Prepaid ice melt, bought by somebody who will never have an account.
 *
 * The whole thing is one page and one payment. A client deciding in October
 * whether to prepay a winter is not going to make an account, and every field
 * after the fourth costs bookings. Name, email, address, what they want, pay.
 *
 * Everything runs on the admin client because the buyer has no account and
 * never will. There is nothing to leak: the page reads a price list and
 * writes one order, and the prices are what the form exists to advertise.
 *
 * Nothing downstream is created until the money actually lands. An unpaid row
 * is somebody who opened the card sheet and closed it, which is not a client,
 * not a property and not a job.
 */

export type SaltResult = { ok: true; url: string } | { ok: false; message: string };

function describe(err: unknown): string {
  console.error("salt action failed:", err);
  return "Something went wrong on our end. Please try again.";
}

export interface SaltOffer {
  organizationName: string;
  /** What one treatment costs, by surface, already rounded for reading. */
  prices: { surface: Surface; label: string; perTreatment: string; forMinimum: string }[];
  minimum: number;
  petSurcharge: string | null;
  canPay: boolean;
}

/** The settings this organisation prices from, with the defaults behind them. */
function settingsFrom(row: Record<string, unknown> | null): SaltSettings {
  if (!row) return DEFAULT_SALT_SETTINGS;
  const num = (key: string, fallback: number) => {
    const value = Number(row[key]);
    return Number.isFinite(value) && value > 0 ? value : fallback;
  };
  return {
    bagCostCents: num("salt_bag_cost_cents", DEFAULT_SALT_SETTINGS.bagCostCents),
    petBagCostCents: num("salt_pet_bag_cost_cents", DEFAULT_SALT_SETTINGS.petBagCostCents),
    bagPounds: num("salt_bag_pounds", DEFAULT_SALT_SETTINGS.bagPounds),
    sidewalkPounds: num("salt_sidewalk_pounds", DEFAULT_SALT_SETTINGS.sidewalkPounds),
    drivewayPounds: num("salt_driveway_pounds", DEFAULT_SALT_SETTINGS.drivewayPounds),
    sidewalkMinutes: num("salt_sidewalk_minutes", DEFAULT_SALT_SETTINGS.sidewalkMinutes),
    drivewayMinutes: num("salt_driveway_minutes", DEFAULT_SALT_SETTINGS.drivewayMinutes),
    crewCostPerHourCents: DEFAULT_SALT_SETTINGS.crewCostPerHourCents,
    overheadPerCrewHourCents: DEFAULT_SALT_SETTINGS.overheadPerCrewHourCents,
    multiplier: DEFAULT_SALT_SETTINGS.multiplier,
    // Zero is a real answer here, so it cannot go through the positive-only
    // reader above.
    petSurchargeCents: Math.max(0, Number(row.salt_pet_surcharge_cents) || 0),
  };
}

/** The organisation this form sells for, and what it charges. */
async function offering() {
  const admin = createAdminClient();
  // One organisation runs this app. Taking the first rather than asking the
  // client which business they are buying from, which they neither know nor
  // should be asked.
  const { data } = await admin
    .from("organizations")
    .select("*")
    .order("created_at")
    .limit(1)
    .maybeSingle();
  return { admin, org: data as Record<string, unknown> | null };
}

/** What the form shows before anybody has typed anything. */
export async function saltOffer(): Promise<SaltOffer | null> {
  try {
    const { org } = await offering();
    if (!org) return null;
    if (org.salt_enabled === false) return null;

    const settings = settingsFrom(org);
    const prices = (["sidewalks", "driveway", "both"] as Surface[]).map((surface) => {
      const quote = quoteOrder(
        { surface, petFriendly: false, treatments: MINIMUM_TREATMENTS },
        settings
      );
      return {
        surface,
        label: SURFACE_LABEL[surface],
        perTreatment: money(quote.perTreatmentCents),
        forMinimum: money(quote.totalCents),
      };
    });

    return {
      organizationName: (org.name as string) ?? "us",
      prices,
      minimum: MINIMUM_TREATMENTS,
      petSurcharge:
        settings.petSurchargeCents > 0 ? money(settings.petSurchargeCents) : null,
      canPay: isStripeConfigured,
    };
  } catch (err) {
    console.error("couldn't read the salt offer:", err);
    return null;
  }
}

/**
 * Take the order and open the card form.
 *
 * The row is written unpaid before the client is sent to Stripe, because
 * Stripe needs somewhere to come back to and the webhook needs something to
 * find. Nothing about an unpaid row puts anybody on a schedule.
 */
export async function startSaltOrder(input: {
  name: string;
  email: string;
  address: string;
  phone?: string;
  surface: string;
  petFriendly: boolean;
  treatments: number;
  note?: string;
  /** From the address suggestion they picked, when they picked one. */
  lat?: number | null;
  lng?: number | null;
}): Promise<SaltResult> {
  try {
    const name = input.name.trim();
    const email = input.email.trim().toLowerCase();
    const address = input.address.trim();

    if (!name) return { ok: false, message: "We need a name to put the order under." };
    if (!email.includes("@")) return { ok: false, message: "That email does not look right." };
    if (address.length < 6) return { ok: false, message: "We need the full address to find you." };
    if (!isSurface(input.surface)) return { ok: false, message: "Pick what you would like salted." };

    const { admin, org } = await offering();
    if (!org) return { ok: false, message: "We are not taking orders right now." };
    if (org.salt_enabled === false) {
      return { ok: false, message: "We have stopped taking prepaid orders for this winter." };
    }
    if (!isStripeConfigured) {
      return { ok: false, message: "Card payments are not switched on yet. Give us a call and we will book you in." };
    }

    const settings = settingsFrom(org);
    // Priced on the server from the server's own settings. The browser shows
    // a price; it does not get to name one.
    const quote = quoteOrder(
      { surface: input.surface, petFriendly: Boolean(input.petFriendly), treatments: input.treatments },
      settings
    );

    const baseUrl = await outboundBaseUrl();
    if (!baseUrl) return { ok: false, message: "Could not start that payment. Try again." };

    // Placed here rather than after paying, so an address that cannot be found
    // is still an order somebody can finish by hand rather than a payment with
    // nowhere to attach. Never a reason to refuse the sale.
    const placed = await placeAddress(address, input.lat, input.lng);

    const { data: order, error } = await admin
      .from("salt_orders")
      .insert({
        organization_id: org.id as string,
        name: name.slice(0, 120),
        email: email.slice(0, 200),
        address: address.slice(0, 300),
        phone: input.phone?.trim().slice(0, 40) || null,
        lat: placed?.lat ?? null,
        lng: placed?.lng ?? null,
        surface: input.surface,
        pet_friendly: Boolean(input.petFriendly),
        treatments: quote.treatments,
        per_treatment_cents: quote.perTreatmentCents,
        amount_cents: quote.totalCents,
        status: "unpaid",
        note: input.note?.trim().slice(0, 500) || null,
      })
      .select("id")
      .single();

    if (error || !order) return { ok: false, message: describe(error) };

    const stripe = stripeClient();
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      customer_email: email,
      line_items: [
        {
          price_data: {
            currency: "usd",
            unit_amount: quote.perTreatmentCents,
            product_data: {
              name: `Ice melt — ${SURFACE_LABEL[input.surface]}${input.petFriendly ? ", pet safe" : ""}`,
              description: `${quote.treatments} prepaid treatments at ${address}. Calcium chloride, never rock salt.`,
            },
          },
          quantity: quote.treatments,
        },
      ],
      success_url: `${absolute(baseUrl, `/salt/done/${order.id}`)}?paid=1`,
      cancel_url: absolute(baseUrl, "/salt"),
      metadata: { salt_order_id: order.id, organization_id: org.id as string },
    });

    if (!session.url) return { ok: false, message: "Could not open the card form. Try again." };

    await admin
      .from("salt_orders")
      .update({ checkout_session_id: session.id, updated_at: new Date().toISOString() })
      .eq("id", order.id);

    return { ok: true, url: session.url };
  } catch (err) {
    return { ok: false, message: describe(err) };
  }
}

/**
 * Coordinates for the address, from whatever we have.
 *
 * The suggestion they picked is best, because it is the address the map knows
 * rather than the one they typed. Falling back to a lookup covers somebody who
 * typed it out and ignored the suggestions, and falling back to nothing covers
 * an outage. None of the three is a reason to turn down money.
 */
async function placeAddress(
  address: string,
  lat?: number | null,
  lng?: number | null
): Promise<{ lat: number; lng: number } | null> {
  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    return { lat: Number(lat), lng: Number(lng) };
  }
  try {
    const lookup = await lookupAddress(address, undefined, { autocomplete: false });
    if (!lookup.ok) return null;
    const first = lookup.suggestions[0];
    return first ? { lat: first.lat, lng: first.lng } : null;
  } catch {
    return null;
  }
}

/**
 * The money landed, so put them on the round.
 *
 * Called from the webhook and from the page they come back to, because a
 * client who closes the tab on the receipt has still paid and a webhook
 * thirty seconds behind should not leave somebody looking at "not paid yet".
 *
 * Idempotent through the status check: whichever arrives first creates the
 * client, the property and the job, and the second finds a paid row and stops.
 *
 * The job is created approved rather than estimating. It is sold work that
 * has been paid for, and putting it anywhere else would mean somebody has to
 * go and quote a thing the client already bought.
 */
export async function settleSaltOrder(orderId: string): Promise<void> {
  const admin = createAdminClient();
  const { data: order } = await admin
    .from("salt_orders")
    .select(
      "id, organization_id, name, email, address, phone, lat, lng, surface, pet_friendly, treatments, status, checkout_session_id"
    )
    .eq("id", orderId)
    .maybeSingle();

  if (!order || order.status !== "unpaid" || !order.checkout_session_id) return;
  if (!isStripeConfigured) return;

  try {
    const stripe = stripeClient();
    const session = await stripe.checkout.sessions.retrieve(order.checkout_session_id);
    if (session.payment_status !== "paid") return;

    // Claimed before anything is created. Two settles racing would otherwise
    // make two clients, two properties and two jobs out of one order.
    const { data: claimed } = await admin
      .from("salt_orders")
      .update({ status: "paid", paid_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("id", order.id)
      .eq("status", "unpaid")
      .select("id")
      .maybeSingle();
    if (!claimed) return;

    const placed = await placeClient(admin, order);
    // A property needs coordinates and an unplaceable address has none. The
    // client still becomes a client and the order still stands; what is left
    // is one address for somebody to fix, which the order list says out loud.
    const jobId = placed.propertyId ? await openJob(admin, order, placed.propertyId) : null;

    await admin
      .from("salt_orders")
      .update({
        customer_id: placed.customerId,
        property_id: placed.propertyId,
        job_id: jobId,
        updated_at: new Date().toISOString(),
      })
      .eq("id", order.id);

    // A way back in with no password, the same as a booked evaluation gets.
    await ensureClientAccount({ customerId: placed.customerId, email: order.email }).catch(() => null);
  } catch (err) {
    console.error("couldn't settle a salt order:", err);
  }
}

/**
 * The client and their property, matched to whoever we already know.
 *
 * The same matcher the office uses, so somebody who had a hedge cut in June
 * lands on their existing record rather than becoming a second person with
 * the same name.
 */
async function placeClient(
  admin: ReturnType<typeof createAdminClient>,
  order: {
    organization_id: string;
    name: string;
    email: string;
    phone: string | null;
    address: string;
    lat: number | null;
    lng: number | null;
  }
): Promise<{ customerId: string; propertyId: string | null }> {
  const { data: existing } = await admin
    .from("customers")
    .select("id, name, email, phone")
    .eq("organization_id", order.organization_id);

  const duplicate = findDuplicateCustomer(existing ?? [], {
    name: order.name,
    email: order.email,
    phone: order.phone ?? "",
  });

  let customerId: string;
  if (duplicate) {
    customerId = duplicate.id;
    // Fills blanks only. An order form must not overwrite a spelling or a
    // phone number the office has already corrected by hand.
    const patch = mergeableFields(
      { name: duplicate.name ?? null, email: duplicate.email ?? null, phone: duplicate.phone ?? null },
      { name: order.name, email: order.email, phone: order.phone ?? "" }
    );
    if (Object.keys(patch).length > 0) {
      await admin.from("customers").update(patch).eq("id", customerId);
    }
  } else {
    const { data: created, error } = await admin
      .from("customers")
      .insert({
        organization_id: order.organization_id,
        name: order.name,
        email: order.email,
        phone: order.phone,
        source: "Ice melt form",
      })
      .select("id")
      .single();
    if (error || !created) throw error ?? new Error("no customer");
    customerId = created.id;
  }

  const { data: properties } = await admin
    .from("properties")
    .select("id, address")
    .eq("customer_id", customerId);

  const sameProperty = findDuplicateProperty(properties ?? [], order.address);
  if (sameProperty) return { customerId, propertyId: sameProperty.id };

  // No coordinates, no property row. The order is already paid and recorded,
  // so this is a job for a person rather than a failure to report to a client
  // who has done nothing wrong.
  if (order.lat == null || order.lng == null) return { customerId, propertyId: null };

  const { data: property, error: propertyError } = await admin
    .from("properties")
    .insert({ customer_id: customerId, address: order.address, lat: order.lat, lng: order.lng })
    .select("id")
    .single();
  if (propertyError || !property) {
    console.error("couldn't place a salt order's property:", propertyError);
    return { customerId, propertyId: null };
  }

  return { customerId, propertyId: property.id };
}

/**
 * The job that puts them on the round.
 *
 * Approved, not estimating: it is sold work that has already been paid for,
 * and anything else would put it in front of somebody whose task is to go and
 * quote it. No dates on it, because nobody knows when it will snow. What
 * makes it findable is the name, which says what was bought.
 */
async function openJob(
  admin: ReturnType<typeof createAdminClient>,
  order: {
    address: string;
    surface: string;
    pet_friendly: boolean;
    treatments: number;
    organization_id: string;
  },
  propertyId: string
): Promise<string | null> {
  const surface = SURFACE_LABEL[order.surface as Surface] ?? order.surface;
  const { data: job, error } = await admin
    .from("jobs")
    .insert({
      property_id: propertyId,
      name: `Ice melt — ${surface}${order.pet_friendly ? " (pet safe)" : ""} — ${order.treatments} prepaid`,
      status: "approved",
      client_notes:
        `Prepaid ${order.treatments} ice melt treatments on ${surface.toLowerCase()}. ` +
        `${order.pet_friendly ? "Pet safe blend. " : "Calcium chloride. "}` +
        "Booked and paid through the winter form. Call before the first storm.",
    })
    .select("id")
    .maybeSingle();

  if (error) {
    console.error("couldn't open a job for a salt order:", error);
    return null;
  }

  // Filed against the snow service where there is one, so the round can be
  // pulled up by service rather than by reading job names.
  if (job) {
    const { data: service } = await admin
      .from("services")
      .select("service_type_id")
      .eq("organization_id", order.organization_id)
      .ilike("name", "%snow%")
      .limit(1)
      .maybeSingle();
    if (service) {
      await admin
        .from("job_requested_services")
        .insert({
          job_id: job.id,
          organization_id: order.organization_id,
          service_type_id: service.service_type_id,
        })
        .then(undefined, () => {});
    }
  }

  return job?.id ?? null;
}

/** What the client sees on the page they land on after paying. */
export async function saltOrderSummary(orderId: string): Promise<{
  name: string;
  address: string;
  surface: string;
  petFriendly: boolean;
  treatments: number;
  total: string;
  paid: boolean;
} | null> {
  try {
    const admin = createAdminClient();
    const { data } = await admin
      .from("salt_orders")
      .select("name, address, surface, pet_friendly, treatments, amount_cents, status")
      .eq("id", orderId)
      .maybeSingle();
    if (!data) return null;

    return {
      name: data.name,
      address: data.address,
      surface: SURFACE_LABEL[data.surface as Surface] ?? data.surface,
      petFriendly: data.pet_friendly,
      treatments: data.treatments,
      total: money(data.amount_cents),
      paid: data.status === "paid",
    };
  } catch {
    return null;
  }
}
