"use server";

import { randomBytes } from "node:crypto";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/team";
import { getCurrentOrganizationId } from "@/lib/data/organizations";
import { describeDbError } from "@/lib/setup-errors";
import { FLYERS_PER_RUN, SPOT_PRICE_CENTS } from "@/lib/flyer-offer";

const PATH = "/admin/flyer";

export type RunResult = { ok: true; message?: string } | { ok: false; message: string };

async function requireAdmin() {
  const profile = await getCurrentProfile();
  return profile?.roles.includes("admin") ? profile : null;
}

/**
 * Open a run for bookings.
 *
 * Only one is open at a time. The public link sells "the open run", so two of
 * them means the link picks one and half the adverts land on a flyer nobody
 * meant them to be on. Opening a new one closes whatever was open.
 */
export async function createFlyerRun(input: {
  name: string;
  mailsOn?: string;
  flyerCount?: number;
  spotPriceCents?: number;
}): Promise<RunResult> {
  try {
    if (!(await requireAdmin())) return { ok: false, message: "Only admins can open a run." };
    const name = input.name.trim();
    if (!name) return { ok: false, message: "Give the run a name, like October run." };

    const [supabase, organizationId] = await Promise.all([
      createClient(),
      getCurrentOrganizationId(),
    ]);

    const { error: closeError } = await supabase
      .from("flyer_runs")
      .update({ status: "closed" })
      .eq("organization_id", organizationId)
      .eq("status", "open");
    if (closeError) return { ok: false, message: describeDbError(closeError) };

    const { error } = await supabase.from("flyer_runs").insert({
      organization_id: organizationId,
      name,
      mails_on: input.mailsOn?.trim() || null,
      flyer_count: input.flyerCount ?? FLYERS_PER_RUN,
      spot_price_cents: input.spotPriceCents ?? SPOT_PRICE_CENTS,
      status: "open",
    });
    if (error) return { ok: false, message: describeDbError(error) };

    revalidatePath(PATH);
    return { ok: true, message: `${name} is open and the link is live.` };
  } catch (err) {
    console.error("createFlyerRun failed:", err);
    return { ok: false, message: "Could not open that run." };
  }
}

/** Stop taking bookings, or start again. */
export async function setFlyerRunStatus(input: {
  runId: string;
  status: "open" | "closed" | "printed";
}): Promise<RunResult> {
  try {
    if (!(await requireAdmin())) return { ok: false, message: "Only admins can change a run." };

    const [supabase, organizationId] = await Promise.all([
      createClient(),
      getCurrentOrganizationId(),
    ]);

    // Reopening one closes any other, for the same reason opening does.
    if (input.status === "open") {
      await supabase
        .from("flyer_runs")
        .update({ status: "closed" })
        .eq("organization_id", organizationId)
        .eq("status", "open");
    }

    const { error } = await supabase
      .from("flyer_runs")
      .update({ status: input.status })
      .eq("id", input.runId);
    if (error) return { ok: false, message: describeDbError(error) };

    revalidatePath(PATH);
    return { ok: true };
  } catch (err) {
    console.error("setFlyerRunStatus failed:", err);
    return { ok: false, message: "Could not change that run." };
  }
}

/** Set or move the date it goes to the post office. */
export async function setFlyerRunDate(input: {
  runId: string;
  mailsOn: string | null;
}): Promise<RunResult> {
  try {
    if (!(await requireAdmin())) return { ok: false, message: "Only admins can change a run." };
    const supabase = await createClient();
    const { error } = await supabase
      .from("flyer_runs")
      .update({ mails_on: input.mailsOn || null })
      .eq("id", input.runId);
    if (error) return { ok: false, message: describeDbError(error) };
    revalidatePath(PATH);
    return { ok: true };
  } catch (err) {
    console.error("setFlyerRunDate failed:", err);
    return { ok: false, message: "Could not change that date." };
  }
}

/**
 * Put an advertiser on a run by hand.
 *
 * Most spots are sold on the phone and paid by card, but not all: somebody
 * pays cash, somebody swaps a spot for work, somebody has always been on the
 * flyer. Without this the only way onto a run is the public form, which means
 * the office either fakes a card payment or keeps a note somewhere the printer
 * never sees.
 *
 * Marked paid outright, because the office adding somebody is the office
 * saying it is settled.
 */
export async function addBookingToRun(input: {
  runId: string;
  businessName: string;
  slot?: number | null;
  phone?: string;
  amountCents?: number | null;
}): Promise<RunResult> {
  try {
    if (!(await requireAdmin())) return { ok: false, message: "Only admins can change a run." };
    const businessName = input.businessName.trim();
    if (!businessName) return { ok: false, message: "Give the business a name." };

    const [supabase, organizationId] = await Promise.all([
      createClient(),
      getCurrentOrganizationId(),
    ]);

    const { data: run } = await supabase
      .from("flyer_runs")
      .select("spot_price_cents")
      .eq("id", input.runId)
      .maybeSingle();
    if (!run) return { ok: false, message: "That run isn't there." };

    const { error } = await supabase.from("flyer_bookings").insert({
      organization_id: organizationId,
      run_id: input.runId,
      business_name: businessName,
      phone: input.phone?.trim() || null,
      slot: input.slot ?? null,
      status: "placed",
      amount_cents: input.amountCents ?? run.spot_price_cents,
      paid_at: new Date().toISOString(),
      token: randomBytes(16).toString("hex"),
    });
    if (error) return { ok: false, message: describeDbError(error) };

    revalidatePath(PATH);
    return { ok: true, message: `${businessName} added to the run.` };
  } catch (err) {
    console.error("addBookingToRun failed:", err);
    return { ok: false, message: "Could not add them." };
  }
}

/**
 * Move a booking to a square, or take it out of one.
 *
 * The unique index on (run, slot) is what actually stops two adverts landing
 * in one square, so a clash comes back as a message rather than as a flyer
 * with a mistake printed 2,500 times.
 */
export async function setBookingSlot(input: {
  bookingId: string;
  slot: number | null;
}): Promise<RunResult> {
  try {
    if (!(await requireAdmin())) return { ok: false, message: "Only admins can change a run." };
    if (input.slot != null && (input.slot < 1 || input.slot > 8)) {
      return { ok: false, message: "That is not a square on the sheet." };
    }

    const supabase = await createClient();
    const { error } = await supabase
      .from("flyer_bookings")
      .update({ slot: input.slot })
      .eq("id", input.bookingId);

    if (error) {
      // 23505 is the unique index doing its job.
      if (error.code === "23505") {
        return { ok: false, message: "Something is already in that square. Clear it first." };
      }
      return { ok: false, message: describeDbError(error) };
    }

    revalidatePath(PATH);
    return { ok: true };
  } catch (err) {
    console.error("setBookingSlot failed:", err);
    return { ok: false, message: "Could not move that." };
  }
}

/** Take somebody off a run entirely. */
export async function removeBookingFromRun(bookingId: string): Promise<RunResult> {
  try {
    if (!(await requireAdmin())) return { ok: false, message: "Only admins can change a run." };
    const supabase = await createClient();
    const { error } = await supabase.from("flyer_bookings").delete().eq("id", bookingId);
    if (error) return { ok: false, message: describeDbError(error) };
    revalidatePath(PATH);
    return { ok: true };
  } catch (err) {
    console.error("removeBookingFromRun failed:", err);
    return { ok: false, message: "Could not remove them." };
  }
}
