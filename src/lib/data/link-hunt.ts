import { createAdminClient } from "@/lib/supabase/admin";
import { log } from "@/lib/log";
import { cleanPostUrl } from "@/lib/outreach-agent";
import { isPostLink } from "@/lib/post-board";
import { HUNT_MAX_TRIES, HUNT_RETRY_MS, HUNT_WITHIN_DAYS, huntUrl, huntWords, samePost } from "@/lib/link-hunt";

export interface LinkHunt {
  id: string;
  url: string;
  words: string;
  author: string | null;
}

/**
 * A few requests read without their link, newest first, for the extension
 * to look for again. Each is marked handed out, so two computers do not
 * both go after it and it is not asked for again for a while.
 */
export async function handOutHunts(organizationId: string, now: Date, limit = 3): Promise<LinkHunt[]> {
  const admin = createAdminClient();
  const since = new Date(now.getTime() - HUNT_WITHIN_DAYS * 86_400_000).toISOString();
  const retry = new Date(now.getTime() - HUNT_RETRY_MS).toISOString();
  const { data, error } = await admin
    .from("outreach_seen_posts")
    .select("id, text, author, group_name, group_key, link_hunt_at")
    .eq("organization_id", organizationId)
    .eq("platform", "facebook")
    .eq("kind", "request")
    .eq("url", "")
    .lt("link_hunt_tries", HUNT_MAX_TRIES)
    .gte("created_at", since)
    // Quoted: a timestamp has dots and colons, which an unquoted value in
    // an or() filter is split on, and the whole filter then fails.
    .or(`link_hunt_at.is.null,link_hunt_at.lt."${retry}"`)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) {
    log.warn("finder.hunt_query_failed", { error: error.message });
    return [];
  }
  const hunts: LinkHunt[] = [];
  for (const row of data ?? []) {
    const words = huntWords(row.text ?? "", [row.group_name, row.author]);
    if (words.split(/\s+/).length < 3) continue;
    hunts.push({ id: row.id, url: huntUrl(words, row.group_key), words, author: row.author });
  }
  if (hunts.length > 0) {
    await admin.from("outreach_seen_posts").update({ link_hunt_at: now.toISOString() }).in("id", hunts.map((h) => h.id)).eq("organization_id", organizationId);
  }
  return hunts;
}

/**
 * What the extension found for one: the link, and the words of the post it
 * came from. Kept only when those words are the post's own; otherwise it
 * counts as a try.
 */
export async function reportHunt(
  organizationId: string,
  input: { id: string; url: string | null; text: string | null },
  now: Date
): Promise<{ saved: boolean; reason?: string }> {
  const admin = createAdminClient();
  const { data: row } = await admin
    .from("outreach_seen_posts")
    .select("id, url, text, author, group_name, link_hunt_tries")
    .eq("organization_id", organizationId)
    .eq("id", input.id)
    .maybeSingle();
  if (!row) return { saved: false, reason: "not found" };
  if (row.url) return { saved: false, reason: "already has a link" };

  const url = input.url && /^https:\/\/(www\.|m\.)?facebook\.com\//.test(input.url) ? cleanPostUrl(input.url) : "";
  const same = Boolean(url && isPostLink(url) && input.text && samePost(row.text ?? "", input.text, [row.group_name, row.author]));
  if (!same) {
    await admin
      .from("outreach_seen_posts")
      .update({ link_hunt_tries: (row.link_hunt_tries ?? 0) + 1, updated_at: now.toISOString() })
      .eq("id", row.id);
    return { saved: false, reason: url ? "not the same post" : "no link" };
  }
  await admin
    .from("outreach_seen_posts")
    .update({ url, link_hunt_tries: (row.link_hunt_tries ?? 0) + 1, updated_at: now.toISOString() })
    .eq("id", row.id);
  return { saved: true };
}
