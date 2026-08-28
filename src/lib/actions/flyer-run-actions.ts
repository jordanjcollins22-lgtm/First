"use server";

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
