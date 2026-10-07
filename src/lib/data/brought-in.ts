import { randomUUID } from "node:crypto";

import { createAdminClient } from "@/lib/supabase/admin";
import { appUrl } from "@/lib/app-url";
import { broughtInRows, type BroughtInJob, type BroughtInRow } from "@/lib/brought-in";

/**
 * Every job this person is named as having brought in, with where it has
 * got to. Read on the service-role client and filtered to their own name:
 * a crew member's own row-level access stops at the jobs they are booked on,
 * and these are by definition jobs they are not booked on yet.
 */
export async function getBroughtIn(profileId: string): Promise<BroughtInRow[]> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("jobs")
    .select("id, status, evaluation_date, created_at, properties(address, customers(name)), job_proposals(status, total_cost, discount_amount)")
    .eq("referred_by_profile_id", profileId)
    .order("created_at", { ascending: false })
    .limit(100);

  const jobs: BroughtInJob[] = ((data ?? []) as unknown as {
    id: string;
    status: string;
    evaluation_date: string | null;
    created_at: string;
    properties: { address: string | null; customers: { name: string | null } | null } | null;
    job_proposals: { status: string; total_cost: number | string | null; discount_amount: number | string | null }[] | { status: string; total_cost: number | string | null; discount_amount: number | string | null } | null;
  }[]).map((j) => {
    const proposal = Array.isArray(j.job_proposals) ? (j.job_proposals[0] ?? null) : j.job_proposals;
    return {
      jobId: j.id,
      client: j.properties?.customers?.name ?? "Client",
      address: j.properties?.address ?? "",
      jobStatus: j.status,
      evaluationDate: j.evaluation_date,
      proposalStatus: proposal?.status ?? null,
      price: proposal?.total_cost == null ? null : Number(proposal.total_cost) - Number(proposal.discount_amount ?? 0),
      createdAt: j.created_at,
    };
  });
  return broughtInRows(jobs);
}

/**
 * Their own booking link, made the first time they need one. Anything booked
 * through it is credited to them by name, which is what the 4% is paid on.
 */
export async function myBookingLink(profile: { id: string; affiliate_slug: string | null }, baseUrl: string): Promise<string | null> {
  let slug = profile.affiliate_slug;
  if (!slug) {
    const admin = createAdminClient();
    const fresh = randomUUID().replace(/-/g, "").slice(0, 10);
    const { error } = await admin.from("profiles").update({ affiliate_slug: fresh }).eq("id", profile.id).is("affiliate_slug", null);
    if (!error) slug = fresh;
    else {
      const { data } = await admin.from("profiles").select("affiliate_slug").eq("id", profile.id).maybeSingle();
      slug = data?.affiliate_slug ?? null;
    }
  }
  return slug ? appUrl(baseUrl, `/book?ref=${slug}`) : null;
}
