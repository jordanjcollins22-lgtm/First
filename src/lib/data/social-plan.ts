import { createClient } from "@/lib/supabase/server";
import { outboundBaseUrl } from "@/lib/base-url";
import { trackedLink } from "@/lib/outreach-links";
import type { CardStyle, PlanKind, Placement } from "@/lib/social-plan";
import { tidyCrop, type Crop } from "@/lib/social-crop";
import { tidyLayout, type Layout } from "@/lib/social-layout";

export interface PlanPost {
  id: string;
  day: string;
  kind: PlanKind | null;
  status: string;
  hook: string;
  body: string;
  cta: string;
  hashtags: string[];
  cardStyle: CardStyle | null;
  jobId: string | null;
  beforeId: string | null;
  afterId: string | null;
  beforeCrop: Crop;
  afterCrop: Crop;
  layout: Layout;
  placement: Placement;
  /** The drawn picture, with the last change in it so an edit shows at once. */
  imageUrl: string;
  link: string | null;
  clicks: number;
  scheduledFor: string | null;
  postedAt: string | null;
}

/** The planned posts from a day on, in day order. */
export async function listPlanPosts(organizationId: string, fromDay: string, limit = 21): Promise<PlanPost[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("social_posts")
    .select("id, plan_day, kind, status, hook, body, cta, hashtags, card_style, job_id, before_photo_id, after_photo_id, before_crop, after_crop, layout, placement, scheduled_for, posted_at, updated_at, link:outreach_links(code, click_count)")
    .eq("organization_id", organizationId)
    .not("plan_day", "is", null)
    .gte("plan_day", fromDay)
    .neq("status", "skipped")
    .order("plan_day")
    .order("placement", { ascending: false })
    .limit(limit);
  if (error) throw error;
  const base = await outboundBaseUrl();
  type Row = {
    id: string;
    plan_day: string;
    kind: string | null;
    status: string;
    hook: string | null;
    body: string | null;
    cta: string | null;
    hashtags: string[] | null;
    card_style: string | null;
    job_id: string | null;
    before_photo_id: string | null;
    after_photo_id: string | null;
    before_crop: unknown;
    after_crop: unknown;
    layout: unknown;
    placement: string | null;
    scheduled_for: string | null;
    posted_at: string | null;
    updated_at: string;
    link: { code: string; click_count: number } | { code: string; click_count: number }[] | null;
  };
  return ((data ?? []) as unknown as Row[]).map((r) => {
    const link = Array.isArray(r.link) ? r.link[0] : r.link;
    return {
      id: r.id,
      day: r.plan_day,
      kind: (r.kind as PlanKind | null) ?? null,
      status: r.status,
      hook: r.hook ?? "",
      body: r.body ?? "",
      cta: r.cta ?? "",
      hashtags: r.hashtags ?? [],
      cardStyle: (r.card_style as CardStyle | null) ?? null,
      jobId: r.job_id,
      beforeId: r.before_photo_id,
      afterId: r.after_photo_id,
      beforeCrop: tidyCrop(r.before_crop),
      afterCrop: tidyCrop(r.after_crop),
      layout: tidyLayout(r.layout),
      placement: r.placement === "group" ? "group" : "page",
      imageUrl: `/api/social/card/${r.id}?v=${encodeURIComponent(r.updated_at)}`,
      link: link?.code ? trackedLink(base, link.code) : null,
      clicks: link?.click_count ?? 0,
      scheduledFor: r.scheduled_for,
      postedAt: r.posted_at,
    };
  });
}

/** How many planned posts are waiting for a yes. */
export async function countPlanDrafts(organizationId: string): Promise<number> {
  const supabase = await createClient();
  const { count } = await supabase
    .from("social_posts")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", organizationId)
    .eq("status", "draft")
    .not("plan_day", "is", null);
  return count ?? 0;
}
