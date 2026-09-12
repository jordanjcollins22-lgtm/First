"use server";

import { randomBytes } from "node:crypto";

import { createAdminClient } from "@/lib/supabase/admin";
import { isStripeConfigured } from "@/lib/env";
import { stripeClient } from "@/lib/stripe-customer";
import { outboundBaseUrl } from "@/lib/base-url";
import { absolute } from "@/lib/proposal-flow";
import { openFlyerRun } from "@/lib/data/public-flyer";
import { isSoldOut, nextRunName, ACCEPTED_TYPES } from "@/lib/flyer-offer";
import { HOUSE_SLOTS, SLOTS } from "@/lib/flyer";
import { needsChecking, settlementFor, MAX_CHECKS_PER_LOAD } from "@/lib/flyer-settlement";

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
 * Somewhere for the browser to put the artwork.
 *
 * The file used to travel to the server inside the form submission, as
 * base64 in a Server Action. Server Actions carry a one megabyte body by
 * default and base64 adds a third on top, so any photo taken on a phone,
 * which is most of them, failed before it reached us. The advertiser saw
 * "something went wrong" at the moment they were handing over three hundred
 * dollars.
 *
 * So the browser uploads straight to storage with a short-lived signed URL
 * and only the path comes through the action. No size ceiling to trip over,
 * and the file never passes through the app at all.
 */
export async function createArtworkUpload(input: {
  orgSlug: string;
  fileType: string;
}): Promise<FlyerResult<{ path: string; token: string }>> {
  try {
    if (!ACCEPTED_TYPES.includes(input.fileType)) {
      return { ok: false, message: "That file type will not print. Send a PNG, JPG or PDF." };
    }

    const run = await openFlyerRun(input.orgSlug);
    if (!run) return { ok: false, message: "There is no run taking bookings right now." };

    const admin = createAdminClient();
    const extension = input.fileType === "application/pdf" ? "pdf" : input.fileType.split("/")[1];
    const path = `${run.organizationId}/${run.runId}/${randomBytes(16).toString("hex")}.${extension}`;

    const { data, error } = await admin.storage.from("flyer-ads").createSignedUploadUrl(path);
    if (error || !data) return { ok: false, message: describe(error) };

    return { ok: true, path, token: data.token };
  } catch (err) {
    return { ok: false, message: describe(err) };
  }
}

/**
 * The run a new booking should go on, opening one if the last is full.
 *
 * A full run used to turn somebody away at the moment they had their card
 * out: "this run just filled up, get in touch about the next one". There is
 * no reason to lose that sale. The full run closes, the next one opens, and
 * they carry on without noticing anything happened.
 *
 * The new run inherits the old one's price and quantity, because those are
 * what was advertised on the page they are standing on. It gets no mail date:
 * that is the office's to set, and a date invented here would be a promise
 * nobody made.
 */
async function runWithRoom(orgSlug: string) {
  const run = await openFlyerRun(orgSlug);
  if (!run) return null;
  if (!isSoldOut(run.taken)) return run;

  const admin = createAdminClient();
  const { data: existing } = await admin
    .from("flyer_runs")
    .select("name")
    .eq("organization_id", run.organizationId);

  const { error: closeError } = await admin
    .from("flyer_runs")
    .update({ status: "closed" })
    .eq("id", run.runId)
    .eq("status", "open");
  if (closeError) return null;

  const { error } = await admin.from("flyer_runs").insert({
    organization_id: run.organizationId,
    name: nextRunName(run.runName, ((existing ?? []) as { name: string }[]).map((r) => r.name)),
    flyer_count: run.flyerCount,
    spot_price_cents: run.spotPriceCents,
    status: "open",
  });
  if (error) return null;

  // Read it back rather than assembling it here, so the caller gets the same
  // shape and the same counts as any other run.
  return openFlyerRun(orgSlug);
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
  /** Where the browser already put the file, from createArtworkUpload. */
  imagePath: string;
  /** Whether this is finished artwork or something for us to design from. */
  artworkKind?: "ready" | "reference";
}): Promise<FlyerResult<{ token: string; imageUrl: string }>> {
  try {
    const businessName = input.businessName.trim();
    if (!businessName) return { ok: false, message: "Tell us the business name." };
    if (!input.imagePath) return { ok: false, message: "Upload your artwork first." };

    // Rolls onto a fresh run if this one filled while they were uploading,
    // rather than turning somebody away with their card already out.
    const run = await runWithRoom(input.orgSlug);
    if (!run) return { ok: false, message: "There is no run taking bookings right now." };

    // Checked against the business rather than trusted, so a hand-edited path
    // cannot attach somebody else's file to a booking. Deliberately not
    // checked against the run: a booking that rolled onto a fresh run carries
    // a path made for the old one, and which folder a file sits in is
    // housekeeping, not access.
    if (!input.imagePath.startsWith(`${run.organizationId}/`)) {
      return { ok: false, message: "Upload your artwork again and try once more." };
    }

    const admin = createAdminClient();
    const path = input.imagePath;
    const token = randomBytes(16).toString("hex");

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

  const used = new Set<number>([...HOUSE_SLOTS, ...((taken ?? []) as { slot: number }[]).map((t) => t.slot)]);
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

/**
 * Ask Stripe whether an outstanding checkout was paid, and settle it.
 *
 * Stripe knows who has paid; it just does not tell this app unless a webhook
 * is set up to carry the news. Asking needs nothing set up: the checkout we
 * opened is recorded against the booking, so it can be read back at any time.
 *
 * Called when somebody looks at their own booking and when the office loads
 * the run, so no payment can stay unnoticed for longer than it takes anybody
 * to glance at the page. Silent and best-effort throughout: a booking that
 * could not be checked is one to check again next time, not an error to put
 * on a screen.
 */
export async function settleFlyerBookings(bookingIds: string[]): Promise<void> {
  try {
    if (!isStripeConfigured || bookingIds.length === 0) return;

    const admin = createAdminClient();
    const { data } = await admin
      .from("flyer_bookings")
      .select("id, status, checkout_session_id")
      .in("id", bookingIds);

    const outstanding = needsChecking(
      ((data ?? []) as { id: string; status: string; checkout_session_id: string | null }[]).map(
        (b) => ({ id: b.id, status: b.status, checkoutSessionId: b.checkout_session_id })
      )
    ).slice(0, MAX_CHECKS_PER_LOAD);

    const stripe = stripeClient();
    for (const booking of outstanding) {
      try {
        const session = await stripe.checkout.sessions.retrieve(booking.checkoutSessionId!);
        const verdict = settlementFor({
          paymentStatus: session.payment_status ?? null,
          status: session.status ?? null,
        });

        if (verdict === "settle") {
          await admin.from("flyer_bookings").update({ status: "paid" }).eq("id", booking.id);
          await placePaidBooking(booking.id);
        } else if (verdict === "expired") {
          // The link died with nothing paid. Clearing it lets them start
          // again rather than being told their spot is already pending.
          await admin
            .from("flyer_bookings")
            .update({ checkout_session_id: null })
            .eq("id", booking.id);
        }
      } catch {
        // One session we could not read is one to read next time.
      }
    }
  } catch {
    // Nothing here is allowed to be visible.
  }
}
