"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/team";

/**
 * How the business turns its overhead into a number a quote can charge.
 *
 * Three assumptions and a switch. All three assumptions are somebody's
 * judgement rather than anything the bank knows -- how many days a month the
 * crew is actually on a paying job, how long a day is, and how many people go
 * out -- which is exactly why they are editable and on screen rather than
 * constants in the pricing.
 *
 * The switch matters more than it looks: it changes every price the business
 * quotes. Kept as a setting rather than a migration precisely so it can be
 * turned back.
 */

export type PerDiemResult = { ok: true } | { ok: false; error: string };

async function save(patch: Record<string, unknown>): Promise<PerDiemResult> {
  const profile = await getCurrentProfile();
  if (!profile) return { ok: false, error: "Not signed in." };
  if (!profile.roles.includes("admin") && !profile.roles.includes("owner")) {
    return { ok: false, error: "Only an owner or admin can change how jobs are priced." };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("organizations")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", profile.organization_id);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/admin/payments");
  revalidatePath("/admin/subscriptions");
  return { ok: true };
}

/**
 * How much of the month is actually earning.
 *
 * A per diem is only as honest as the days you admit to losing. Count all
 * twenty-two working days and the overhead under-recovers every time it rains,
 * because the rent was still due on the days nobody could work.
 */
export async function setWorkingPattern(input: {
  billableDaysPerMonth: number;
  hoursPerDay: number;
  crewSize: number;
}): Promise<PerDiemResult> {
  const days = Math.round(Number(input.billableDaysPerMonth));
  const hours = Number(input.hoursPerDay);
  const crew = Math.round(Number(input.crewSize));

  // A month has no more than 31 days in it, and a crew of nobody bills nothing.
  if (!Number.isFinite(days) || days < 1 || days > 31) {
    return { ok: false, error: "Billable days has to be between 1 and 31." };
  }
  if (!Number.isFinite(hours) || hours <= 0 || hours > 24) {
    return { ok: false, error: "A day is somewhere between 0 and 24 hours." };
  }
  if (!Number.isFinite(crew) || crew < 1 || crew > 50) {
    return { ok: false, error: "Crew size has to be at least one person." };
  }

  return save({
    billable_days_per_month: days,
    crew_hours_per_day: hours,
    crew_size: crew,
  });
}

/**
 * Which way quotes charge overhead.
 *
 * Switching to the per diem changes every price the business quotes, which is
 * the point and is also why it is one visible setting rather than something
 * that happened during a deploy.
 */
export async function setOverheadBasis(input: { basis: string }): Promise<PerDiemResult> {
  if (input.basis !== "percent" && input.basis !== "per_diem") {
    return { ok: false, error: "That is not a way of charging overhead." };
  }
  return save({ overhead_basis: input.basis });
}
