import { createClient } from "@/lib/supabase/server";
import { lastLook } from "@/lib/data/outreach-agent";
import { countOpenPosts, startOfToday } from "@/lib/data/post-board";
import { listComputers } from "@/lib/data/finder-computers";
import { RUNNING_WITHIN_MS } from "@/lib/finder-fleet";

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
    /** People asking for work, all of them on the board: with a link, or a search for the post. */
    onBoard: number;
    answered: number;
  };
  /** Fresh posts nobody on the team has taken yet. */
  waiting: number;
  /** Every computer seen in the last day: whose, running or not, and what it last looked at. */
  computers: { id: string; name: string | null; version: string | null; running: boolean; seenAt: string; lookName: string | null; lookPosts: number | null; lookAt: string | null }[];
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
  const computers = (await listComputers(organizationId).catch(() => []))
    .filter((c) => now.getTime() - new Date(c.lastSeenAt).getTime() < 86_400_000)
    .map((c) => ({
      id: c.id,
      name: c.name,
      version: c.version,
      running: now.getTime() - new Date(c.lastSeenAt).getTime() < RUNNING_WITHIN_MS,
      seenAt: c.lastSeenAt,
      lookName: typeof c.lastLook?.name === "string" ? c.lastLook.name : null,
      lookPosts: typeof c.lastLook?.posts === "number" ? c.lastLook.posts : null,
      lookAt: c.lastLookAt,
    }));

  const rows = posts ?? [];
  const pile = (kind: string | null) => (kind === "request" ? "request" : kind === "promotion" ? "business" : kind ? "other" : "sorting") as FinderLive["latest"][number]["pile"];
  const seenAt = settings?.extension_seen_at ?? null;
  return {
    at: now.toISOString(),
    online: computers.some((c) => c.running) || Boolean(seenAt && now.getTime() - new Date(seenAt).getTime() < ONLINE_WITHIN_MS),
    seenAt,
    look: look ? { name: look.name, at: look.at, posts: look.posts } : null,
    today: {
      read: rows.length,
      requests: rows.filter((r) => r.kind === "request").length,
      businesses: rows.filter((r) => r.kind === "promotion").length,
      onBoard: rows.filter((r) => r.kind === "request").length,
      answered: answered ?? 0,
    },
    waiting,
    computers,
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
