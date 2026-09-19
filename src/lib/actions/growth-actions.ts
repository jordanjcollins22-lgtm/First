"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/team";
import { CATEGORY_LABEL } from "@/lib/growth";
import { isOwnerLevel } from "@/lib/roles";

export type ActionResult<T> = { ok: true; value: T } | { ok: false; error: string };

function failed(err: unknown): { ok: false; error: string } {
  return { ok: false, error: err instanceof Error ? err.message : String(err) };
}

/**
 * "That took me forty minutes."
 *
 * Asked for rather than inferred. The app can count how many decisions came to
 * the owner -- it has that in the audit trail and nobody has to remember
 * anything for it to be true -- but it cannot know whether a decision cost
 * thirty seconds or an afternoon, and there is no honest way to guess. So the
 * hours are logged by hand, briefly, and a week with nothing logged reads as
 * "not logged" rather than as a very good zero.
 */
export async function logOwnerTime(input: {
  minutes: number;
  category: string;
  jobId?: string | null;
  note?: string | null;
  occurredOn?: string | null;
}): Promise<ActionResult<{ id: string }>> {
  try {
    const profile = await getCurrentProfile();
    if (!profile) return { ok: false, error: "Not signed in." };
    if (!Number.isFinite(input.minutes) || input.minutes <= 0) {
      return { ok: false, error: "How many minutes?" };
    }
    if (input.minutes > 1440) return { ok: false, error: "That is more than a day." };
    if (!(input.category in CATEGORY_LABEL)) return { ok: false, error: "That is not one of the categories." };

    const supabase = await createClient();
    const { data, error } = await supabase
      .from("owner_interventions")
      .insert({
        organization_id: profile.organization_id as string,
        profile_id: profile.id as string,
        minutes: Math.round(input.minutes),
        category: input.category,
        job_id: input.jobId ?? null,
        note: input.note?.trim() || null,
        occurred_on: input.occurredOn ?? new Date().toISOString().slice(0, 10),
        recorded_by: profile.id as string,
      })
      .select("id")
      .single();
    if (error) throw error;

    revalidatePath("/my-day");
    return { ok: true, value: { id: data.id as string } };
  } catch (err) {
    return failed(err);
  }
}

/**
 * The number of hours a week the owner wants to be down to.
 *
 * Theirs to set, and only theirs: it is the target the whole Growth view is
 * judged against, and a target somebody else can move is not a target.
 */
export async function setOwnerHoursTarget(hours: number): Promise<ActionResult<{ hours: number }>> {
  try {
    const profile = await getCurrentProfile();
    if (!profile) return { ok: false, error: "Not signed in." };
    if (!isOwnerLevel((profile.roles ?? []) as string[])) {
      return { ok: false, error: "Only the owner sets this." };
    }
    if (!Number.isFinite(hours) || hours < 0 || hours > 80) {
      return { ok: false, error: "Give it a number of hours between 0 and 80." };
    }

    const supabase = await createClient();
    const { error } = await supabase
      .from("ops_targets")
      .upsert(
        { organization_id: profile.organization_id as string, owner_hours_per_week: hours },
        { onConflict: "organization_id" }
      );
    if (error) throw error;

    revalidatePath("/my-day");
    return { ok: true, value: { hours } };
  } catch (err) {
    return failed(err);
  }
}
