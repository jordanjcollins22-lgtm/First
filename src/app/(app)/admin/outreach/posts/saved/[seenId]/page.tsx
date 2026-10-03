import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, ExternalLink } from "lucide-react";

import { requireTab } from "@/lib/data/access";
import { getCurrentProfile } from "@/lib/data/team";
import { createAdminClient } from "@/lib/supabase/admin";
import { isOwnerLevel } from "@/lib/roles";
import { PLATFORM_LABEL } from "@/lib/social-finder";
import { shortWhen } from "@/lib/time-zone";

/**
 * A post as it was kept when it was found: the words, who posted it and
 * where, when, the screenshot when somebody added it by hand, and every
 * comment the team put on it with how many clicked. Nothing here is ever
 * deleted, so this is still here after the post itself is taken down.
 * The owner sees any; everybody else, the ones they answered or added.
 */
export const dynamic = "force-dynamic";

export default async function SavedPostPage({ params }: { params: Promise<{ seenId: string }> }) {
  const { seenId } = await params;
  await requireTab("posts-to-answer", "/my-day");
  const profile = await getCurrentProfile();
  if (!profile) return null;
  const admin = createAdminClient();

  const { data: post } = await admin
    .from("outreach_seen_posts")
    .select("id, url, group_name, author, text, platform, posted_at, created_at, screenshot_path, added_by")
    .eq("organization_id", profile.organization_id)
    .eq("id", seenId)
    .maybeSingle();
  if (!post) notFound();

  const { data: answerRows } = await admin
    .from("outreach_post_answers")
    .select("profile_id, status, comment, posted_at, created_at, person:profiles(full_name), link:outreach_links(click_count, posted_comment, comment)")
    .eq("organization_id", profile.organization_id)
    .eq("seen_post_id", seenId)
    .order("created_at");
  type Answer = {
    profile_id: string;
    status: string;
    comment: string | null;
    posted_at: string | null;
    created_at: string;
    person: { full_name: string | null } | null;
    link: { click_count: number | null; posted_comment: string | null; comment: string | null } | null;
  };
  const answers = (answerRows ?? []) as unknown as Answer[];

  const owner = isOwnerLevel(profile.roles);
  if (!owner && post.added_by !== profile.id && !answers.some((a) => a.profile_id === profile.id)) notFound();

  const shot = post.screenshot_path
    ? (await admin.storage.from("recommendation-shots").createSignedUrl(post.screenshot_path, 60 * 60)).data?.signedUrl ?? null
    : null;
  const commented = answers.filter((a) => a.status === "posted" || a.status === "already");

  return (
    <div className="mx-auto w-full max-w-md space-y-4 px-4 py-6">
      <Link href="/admin/outreach/posts#answered" className="flex items-center gap-1 text-sm text-muted-foreground hover:text-primary">
        <ChevronLeft className="h-4 w-4" /> Posts to Answer
      </Link>
      <header>
        <h1 className="text-xl font-semibold">Saved copy</h1>
        <p className="mt-1 text-sm text-muted-foreground">Kept when it was found, so it&apos;s here even if the post is taken down.</p>
      </header>

      <section className="space-y-3 rounded-2xl border border-border bg-card p-4">
        <p className="text-xs text-muted-foreground">
          <span className="mr-1.5 rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-foreground">
            {PLATFORM_LABEL[post.platform] ?? "Facebook"}
          </span>
          <span className="font-medium text-foreground">{post.author ?? "Someone"}</span>
          {post.group_name ? ` in ${post.group_name}` : ""}
        </p>
        <p className="text-xs text-muted-foreground">
          {[post.posted_at ? `Posted ${shortWhen(post.posted_at)}` : null, `Found ${shortWhen(post.created_at)}`].filter(Boolean).join(" · ")}
        </p>
        {post.text && <p className="whitespace-pre-wrap rounded-lg bg-muted/50 p-3 text-sm">{post.text}</p>}
        {shot && (
          // eslint-disable-next-line @next/next/no-img-element -- a signed, short-lived link to a private file
          <img src={shot} alt="The screenshot that was added with this post" className="w-full rounded-lg border border-border" />
        )}
        {post.url && (
          <a href={post.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">
            Open the post <ExternalLink className="h-3.5 w-3.5" />
          </a>
        )}
      </section>

      <section className="rounded-2xl border border-border bg-card p-4">
        <h2 className="text-sm font-semibold">Comments on it</h2>
        {commented.length === 0 ? (
          <p className="mt-1 text-sm text-muted-foreground">Nobody has commented on it yet.</p>
        ) : (
          <ul className="mt-2 divide-y divide-border/60">
            {commented.map((a) => {
              const words = a.link?.posted_comment ?? a.link?.comment ?? a.comment;
              const clicks = a.link?.click_count ?? 0;
              return (
                <li key={`${a.profile_id}-${a.created_at}`} className="py-2.5 text-sm">
                  <p className="font-medium">
                    {a.person?.full_name ?? "Someone"}
                    <span className="font-normal text-muted-foreground">
                      {" · "}
                      {shortWhen(a.posted_at ?? a.created_at)}
                      {a.status === "posted" ? ` · ${clicks} click${clicks === 1 ? "" : "s"}` : " · had already commented"}
                    </span>
                  </p>
                  {words && <p className="mt-1 whitespace-pre-wrap text-muted-foreground">{words}</p>}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
