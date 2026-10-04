import { createClient } from "@/lib/supabase/server";
import { lastLook } from "@/lib/data/outreach-agent";
import { countOpenPosts, startOfToday } from "@/lib/data/post-board";

/** The extension asks the app for its settings once a minute; quieter than this and it isn't running. */
const ONLINE_WITHIN_MS = 3 * 60_000;

export interface FinderLive {
  at: string;
  /** The browser has asked the app for its settings in the last few minutes. */
  online: boolean;
  seenAt: string | null;
  /** Where it last looked, and what that look read. */
  look: { name: string | null; at: string; posts: number | null } | null;
  today: {
    read: number;
    requests: number;
    businesses: number;
    /** People asking for work that a responder can open: the post has a link. */
    onBoard: number;
    answered: number;
  };
  /** Fresh posts nobody on the team has taken yet. */
  waiting: number;
  latest: { id: string; at: string; pile: "request" | "business" | "other" | "sorting"; group: string | null; text: string; hasLink: boolean }[];
}

/** What the finder is doing right now, for the live card. */
export async function getFinderLive(organizationId: string, now: Date = new Date()): Promise<FinderLive> {
  const supabase = await createClient();
  const since = startOfToday(now).toISOString();
  const [{ data: settings }, look, { data: posts }, { count: answered }, waiting] = await Promise.all([
    supabase.from("outreach_agent_settings").select("extension_seen_at").eq("organization_id", organizationId).maybeSingle(),
    lastLook(organizationId).catch(() => null),
    supabase
      .from("outreach_seen_posts")
      .select("id, created_at, kind, url, group_name, text")
      .eq("organization_id", organizationId)
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(1000),
    supabase
      .from("outreach_post_answers")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId)
      .in("status", ["posted", "already"])
      .gte("updated_at", since),
    countOpenPosts(organizationId, now).catch(() => 0),
  ]);

  const rows = posts ?? [];
  const pile = (kind: string | null) => (kind === "request" ? "request" : kind === "promotion" ? "business" : kind ? "other" : "sorting") as FinderLive["latest"][number]["pile"];
  const seenAt = settings?.extension_seen_at ?? null;
  return {
    at: now.toISOString(),
    online: Boolean(seenAt && now.getTime() - new Date(seenAt).getTime() < ONLINE_WITHIN_MS),
    seenAt,
    look: look ? { name: look.name, at: look.at, posts: look.posts } : null,
    today: {
      read: rows.length,
      requests: rows.filter((r) => r.kind === "request").length,
      businesses: rows.filter((r) => r.kind === "promotion").length,
      onBoard: rows.filter((r) => r.kind === "request" && Boolean(r.url)).length,
      answered: answered ?? 0,
    },
    waiting,
    latest: rows.slice(0, 8).map((r) => ({
      id: r.id,
      at: r.created_at,
      pile: pile(r.kind),
      group: r.group_name,
      text: (r.text ?? "").replace(/\s+/g, " ").slice(0, 140),
      hasLink: Boolean(r.url),
    })),
  };
}
