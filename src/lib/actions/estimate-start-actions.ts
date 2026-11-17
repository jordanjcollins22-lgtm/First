"use server";

import { revalidatePath } from "next/cache";

import { isAccountManager } from "@/lib/affiliate-roles";
import { getCurrentProfile } from "@/lib/data/team";
import { isOwnerLevel } from "@/lib/roles";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

/**
 * Opens the free-estimate map for a job the office is pricing: the same map
 * and prices a client gets from the booking page. Makes the job's intake
 * (the map's link) when it has none yet, and hands back its token.
 */
export async function startEstimate(jobId: string): Promise<{ ok: true; token: string } | { ok: false; error: string }> {
  const profile = await getCurrentProfile();
  if (!profile) return { ok: false, error: "Sign in again, then try." };
  if (!isOwnerLevel(profile.roles) && !profile.roles.includes("admin") && !isAccountManager(profile.roles)) {
    return { ok: false, error: "Only the owner or an account manager can price a job." };
  }
  // Read through the signed-in person's own access first, so nobody prices a job they can't see.
  const sb = await createClient();
  const { data: job } = await sb.from("jobs").select("id, property:properties!inner(customer:customers!inner(organization_id))").eq("id", jobId).maybeSingle();
  if (!job) return { ok: false, error: "That job isn't there." };

  const admin = createAdminClient();
  const { data: existing } = await admin.from("evaluation_intakes").select("token").eq("job_id", jobId).maybeSingle();
  if (existing?.token) return { ok: true, token: existing.token };
  const { data, error } = await admin
    .from("evaluation_intakes")
    .insert({ job_id: jobId, organization_id: profile.organization_id })
    .select("token")
    .single();
  if (error || !data) return { ok: false, error: "Couldn't start the estimate. Try again." };
  revalidatePath(`/jobs/${jobId}`);
  return { ok: true, token: data.token };
}
