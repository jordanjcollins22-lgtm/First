"use server";

import { randomBytes } from "node:crypto";

import { createAdminClient } from "@/lib/supabase/admin";
import { isStripeConfigured } from "@/lib/env";
import { stripeClient } from "@/lib/stripe-customer";
import { outboundBaseUrl } from "@/lib/base-url";
import { absolute } from "@/lib/proposal-flow";
import { openFlyerRun } from "@/lib/data/public-flyer";
import { isSoldOut, MAX_UPLOAD_BYTES, ACCEPTED_TYPES } from "@/lib/flyer-offer";
import { HOUSE_SLOT, SLOTS } from "@/lib/flyer";

/** Results rather than throws: a thrown Server Action loses its message in
 * production and reaches a paying advertiser as an unexplained crash. */
export type FlyerResult<T = Record<string, never>> =
  | ({ ok: true } & T)
  | { ok: false; message: string };

function describe(err: unknown): string {
  console.error("public flyer action failed:", err);
  return "Something went wrong on our end. Please try again.";
}

/**
 * Take the artwork and the advertiser's details, before any money.
 *
 * Deliberately separate from paying. Somebody who uploads a design and then
 * loses their nerve at the card form has still told us who they are and what
 * they want, which is a phone call worth making. Charging first and asking
 * afterwards would lose both.
 */
export async function startFlyerBooking(input: {
  orgSlug: string;
  businessName: string;
  contactName?: string;
  email?: string;
  phone?: string;
  /** Base64 data URL of the artwork. */
  artwork: string;
  fileType: string;
  /** Whether this is finished artwork or something for us to design from. */
  artworkKind?: "ready" | "reference";
}): Promise<FlyerResult<{ token: string; imageUrl: string }>> {
  try {
    const businessName = input.businessName.trim();
    if (!businessName) return { ok: false, message: "Tell us the business name." };
    if (!ACCEPTED_TYPES.includes(input.fileType)) {
      return { ok: false, message: "That file type will not print. Send a PNG, JPG or PDF." };
    }

    const run = await openFlyerRun(input.orgSlug);
    if (!run) return { ok: false, message: "There is no run taking bookings right now." };
    if (isSoldOut(run.taken)) {
      return { ok: false, message: "This run just filled up. Get in touch about the next one." };
    }

    const base64 = input.artwork.split(",")[1] ?? "";
    const bytes = Buffer.from(base64, "base64");
    if (bytes.length === 0) return { ok: false, message: "That file came through empty." };
    if (bytes.length > MAX_UPLOAD_BYTES) {
      return { ok: false, message: "That file is over 25MB. Export it a little smaller." };
    }

    const admin = createAdminClient();
    const token = randomBytes(16).toString("hex");
    const extension = input.fileType === "application/pdf" ? "pdf" : input.fileType.split("/")[1];
    const path = `${run.organizationId}/${run.runId}/${token}.${extension}`;

    const { error: uploadError } = await admin.storage
      .from("flyer-ads")
      .upload(path, bytes, { contentType: input.fileType, upsert: true });
    if (uploadError) return { ok: false, message: describe(uploadError) };

    const { error } = await admin.from("flyer_bookings").insert({
      organization_id: run.organizationId,
      run_id: run.runId,
      business_name: businessName,
      contact_name: input.contactName?.trim() || null,
      email: input.email?.trim() || null,
      phone: input.phone?.trim() || null,
      image_path: path,
      artwork_kind: input.artworkKind === "reference" ? "reference" : "ready",
      amount_cents: run.spotPriceCents,
      status: "approved",
      token,
    });
    if (error) return { ok: false, message: describe(error) };

    const { data: publicUrl } = admin.storage.from("flyer-ads").getPublicUrl(path);
    return { ok: true, token, imageUrl: publicUrl.publicUrl };
  } catch (err) {
    return { ok: false, message: describe(err) };
  }
}

/**
 * The card form, opened the moment they approve their own preview.
 *
 * No slot is held until the money lands. Holding one for somebody who has not
 * paid is how a run sells six spots and prints four.
 */
export async function payForFlyerSpot(input: {
  token: string;
}): Promise<FlyerResult<{ url: string }>> {
  try {
    const admin = createAdminClient();
    const { data: booking } = await admin
      .from("flyer_bookings")
      .select("id, organization_id, run_id, business_name, email, amount_cents, status")
      .eq("token", input.token)
      .maybeSingle();

    if (!booking) return { ok: false, message: "That booking link isn't valid." };
    if (booking.status === "paid" || booking.status === "placed") {
      return { ok: false, message: "This spot is already paid for. Nothing else to do." };
    }
    if (!isStripeConfigured) {
      return { ok: false, message: "Card payments aren't switched on yet. Give us a ring." };
    }

    const { data: run } = await admin
      .from("flyer_runs")
      .select("name, flyer_count, status")
      .eq("id", booking.run_id)
      .maybeSingle();
    if (!run || run.status !== "open") {
      return { ok: false, message: "That run has closed. Get in touch about the next one." };
    }

    const baseUrl = await outboundBaseUrl();
    if (!baseUrl) return { ok: false, message: "Couldn't start that payment. Give us a ring." };

    const stripe = stripeClient();
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      customer_email: booking.email || undefined,
      customer_creation: "always",
      line_items: [
        {
          price_data: {
            currency: "usd",
            unit_amount: booking.amount_cents ?? 30_000,
            product_data: {
              name: `Flyer spot, ${run.name}`,
              description: `One advert on ${run.flyer_count.toLocaleString()} flyers.`,
            },
          },
          quantity: 1,
        },
      ],
      success_url: `${absolute(baseUrl, `/flyer/spot/${input.token}`)}?paid=1`,
      cancel_url: absolute(baseUrl, `/flyer/spot/${input.token}`),
      metadata: {
        flyer_booking_id: booking.id,
        organization_id: booking.organization_id,
      },
    });

    if (!session.url) return { ok: false, message: "Couldn't open the card form. Try again." };

    await admin
      .from("flyer_bookings")
      .update({ checkout_session_id: session.id })
      .eq("id", booking.id);

    return { ok: true, url: session.url };
  } catch (err) {
    return { ok: false, message: describe(err) };
  }
}

/**
 * Give a paid booking the next free tile.
 *
 * Called from the Stripe webhook rather than the success page, because an
 * advertiser who closes the tab on the receipt has still paid. The unique
 * index on (run, slot) is the real guarantee: two webhooks racing cannot both
 * win the same square.
 */
export async function placePaidBooking(bookingId: string): Promise<void> {
  const admin = createAdminClient();
  const { data: booking } = await admin
    .from("flyer_bookings")
    .select("id, run_id, slot")
    .eq("id", bookingId)
    .maybeSingle();
  if (!booking || booking.slot != null) return;

  const { data: taken } = await admin
    .from("flyer_bookings")
    .select("slot")
    .eq("run_id", booking.run_id)
    .not("slot", "is", null);

  const used = new Set<number>([HOUSE_SLOT, ...((taken ?? []) as { slot: number }[]).map((t) => t.slot)]);
  const free = SLOTS.find((s) => s.forSale && !used.has(s.slot));

  await admin
    .from("flyer_bookings")
    .update({
      status: free ? "placed" : "paid",
      slot: free?.slot ?? null,
      paid_at: new Date().toISOString(),
    })
    .eq("id", booking.id);
}
