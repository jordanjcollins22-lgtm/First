import type { SupabaseClient } from "@supabase/supabase-js";

import { loadSequenceSettings } from "@/lib/data/client-automations";
import type { DataScope } from "@/lib/data/review-scope";
import { normalizeAutopilot } from "@/lib/marketing/autopilot-settings";
import { townCoverage, type TownCoverage } from "@/lib/seo";
import { normalizeWebsite, type WebsiteContent } from "@/lib/website";

/**
 * Where the business stands on local search, for the review page: what the
 * website covers, which towns the jobs are in, whether review requests and
 * the Business Profile are set up. Counts and town names only: no client's
 * name, address or contact ever leaves here.
 */
export interface SeoStatus {
  content: WebsiteContent;
  orgSlug: string | null;
  websiteSaved: boolean;
  towns: TownCoverage[];
  gbpConnected: boolean;
  gbpWeeklyPostOn: boolean;
  gbpPosts: number;
  postableBeforeAfters: number;
  googleReviews: number;
  reviewRequestsOn: boolean;
  reviewLinkSet: boolean;
  reviewRequestsSent: number;
  ratedFive: number;
  completedJobs: number;
}

const untyped = (c: unknown) => c as SupabaseClient;

export async function loadSeoStatus(scope: DataScope): Promise<SeoStatus> {
  const sb = untyped(scope.client);
  const org = scope.organizationId;
  const count = async (q: PromiseLike<{ count: number | null }>) => (await q).count ?? 0;

  const [{ data: orgRow }, { data: site }, jobs, { data: gbp }, { data: autopilot }, sequences] = await Promise.all([
    sb.from("organizations").select("name, slug").eq("id", org).maybeSingle(),
    sb.from("website_settings").select("content").eq("organization_id", org).maybeSingle(),
    sb
      .from("jobs")
      .select("completed_at, is_test, properties!inner(address, customers!inner(organization_id))")
      .eq("properties.customers.organization_id", org)
      .limit(5000),
    sb.from("integration_credentials").select("status").eq("organization_id", org).eq("provider", "google_business").maybeSingle(),
    sb.from("marketing_autopilot_settings").select("settings").eq("organization_id", org).maybeSingle(),
    loadSequenceSettings(scope.client, org).catch(() => null),
  ]);

  const [gbpPosts, postableBeforeAfters, googleReviews, reviewRequestsSent, ratedFive] = await Promise.all([
    count(sb.from("google_business_posts").select("id", { count: "exact", head: true }).eq("organization_id", org).eq("status", "posted")),
    count(
      sb
        .from("social_posts")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", org)
        .in("status", ["scheduled", "posted"])
        .not("after_photo_id", "is", null)
    ),
    count(sb.from("google_reviews").select("id", { count: "exact", head: true }).eq("organization_id", org)),
    count(sb.from("review_requests").select("id", { count: "exact", head: true }).eq("organization_id", org)),
    count(sb.from("review_requests").select("id", { count: "exact", head: true }).eq("organization_id", org).eq("rating", 5)),
  ]);

  type JobRow = { completed_at: string | null; is_test: boolean | null; properties: { address: string | null } | { address: string | null }[] | null };
  const rows = ((jobs.data ?? []) as JobRow[]).filter((j) => !j.is_test);
  const address = (j: JobRow) => (Array.isArray(j.properties) ? j.properties[0]?.address : j.properties?.address) ?? null;
  const content = normalizeWebsite(site?.content, orgRow?.name);
  const review = sequences?.review_requests;

  return {
    content,
    orgSlug: orgRow?.slug ?? null,
    websiteSaved: Boolean(site),
    towns: townCoverage(
      rows.map((j) => ({ address: address(j), completed: Boolean(j.completed_at) })),
      content.areas.map((a) => a.town)
    ),
    gbpConnected: (gbp as { status?: string } | null)?.status === "connected",
    gbpWeeklyPostOn: normalizeAutopilot((autopilot as { settings?: unknown } | null)?.settings).enabled.gbp_weekly_post,
    gbpPosts,
    postableBeforeAfters,
    googleReviews,
    reviewRequestsOn: Boolean(review?.enabled),
    reviewLinkSet: Boolean(review?.config.googleReviewLink),
    reviewRequestsSent,
    ratedFive,
    completedJobs: rows.filter((j) => j.completed_at).length,
  };
}
