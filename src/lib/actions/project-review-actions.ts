"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/team";

type Result = { ok: true } | { ok: false; error: string };

function refresh(jobId: string) {
  revalidatePath(`/jobs/${jobId}`);
  revalidatePath("/jobs/review");
}

/** Did they leave a five-star review: yes, no, or back to "nobody has said". */
export async function setFiveStarReview(jobId: string, value: boolean | null): Promise<Result> {
  const profile = await getCurrentProfile();
  if (!profile) return { ok: false, error: "Not signed in." };
  const supabase = await createClient();
  const { error } = await supabase
    .from("jobs")
    .update({ five_star_review: value, five_star_review_at: value == null ? null : new Date().toISOString(), five_star_review_by: value == null ? null : profile.id })
    .eq("id", jobId);
  if (error) return { ok: false, error: error.message };
  refresh(jobId);
  return { ok: true };
}

/** This client sent that one to us. The client sent is kept against them, not the job, so it counts wherever they are. */
export async function recordReferral(jobId: string, referrerCustomerId: string, referredCustomerId: string): Promise<Result> {
  const profile = await getCurrentProfile();
  if (!profile) return { ok: false, error: "Not signed in." };
  if (referrerCustomerId === referredCustomerId) return { ok: false, error: "Pick the client they sent, not them." };
  const supabase = await createClient();
  const { error } = await supabase.from("customers").update({ referred_by_customer_id: referrerCustomerId }).eq("id", referredCustomerId);
  if (error) return { ok: false, error: error.message };
  refresh(jobId);
  return { ok: true };
}

/** Clients a referral could be, by name, for the picker. */
export async function findClients(query: string): Promise<{ id: string; name: string }[]> {
  const profile = await getCurrentProfile();
  if (!profile) return [];
  const q = query.trim();
  if (q.length < 2) return [];
  const supabase = await createClient();
  const { data } = await supabase
    .from("customers")
    .select("id, name")
    .eq("organization_id", profile.organization_id)
    .ilike("name", `%${q.replace(/[%_]/g, "")}%`)
    .order("name")
    .limit(8);
  return (data ?? []).map((c) => ({ id: c.id, name: c.name }));
}
