import { createClient } from "@/lib/supabase/server";
import { summariseCompetitors, type CompetitorPost, type CompetitorSummary } from "@/lib/competitor-posts";

/** How far back the other businesses' adverts are read. */
const DAYS = 90;

/** The other businesses' adverts the finder read lately, summed up by what gets a response. */
export async function getCompetitorSummary(organizationId: string, now: Date = new Date()): Promise<CompetitorSummary> {
  const supabase = await createClient();
  const since = new Date(now.getTime() - DAYS * 86_400_000).toISOString();
  const { data, error } = await supabase
    .from("outreach_seen_posts")
    .select("id, url, group_name, author, text, pitch, reactions, comment_count, share_count, created_at, business:outreach_businesses(name)")
    .eq("organization_id", organizationId)
    .eq("kind", "promotion")
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(2000);
  if (error) throw error;
  type Row = {
    id: string;
    url: string | null;
    group_name: string | null;
    author: string | null;
    text: string | null;
    pitch: string | null;
    reactions: number | null;
    comment_count: number | null;
    share_count: number | null;
    created_at: string;
    business: { name: string | null } | null;
  };
  const posts: CompetitorPost[] = ((data ?? []) as unknown as Row[]).map((r) => ({
    id: r.id,
    business: r.business?.name ?? r.author,
    group: r.group_name,
    pitch: r.pitch,
    reactions: r.reactions,
    comments: r.comment_count,
    shares: r.share_count,
    text: (r.text ?? "").replace(/\s+/g, " ").slice(0, 400),
    url: r.url || null,
    at: r.created_at,
  }));
  return summariseCompetitors(posts);
}
