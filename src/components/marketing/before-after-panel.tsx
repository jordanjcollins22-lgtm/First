import Link from "next/link";
import { CalendarClock, CheckCircle2 } from "lucide-react";

import { describeSlot } from "@/lib/social-post";
import type { SocialPost } from "@/lib/data/social";

/**
 * This job's before-and-afters, on the job.
 *
 * Only what somebody approved. A draft or a skipped pair has no business
 * appearing on a customer's job — the whole point of the approval is that
 * nothing about their house exists as a post until a person said it could.
 */
export function BeforeAfterPanel({ posts }: { posts: SocialPost[] }) {
  const shown = posts.filter((post) => post.status === "scheduled" || post.status === "posted");
  if (shown.length === 0) return null;

  return (
    <section className="mt-6 rounded-xl border border-white/60 bg-card/60 p-4 backdrop-blur-md">
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold">Before &amp; after</h2>
        <Link href="/admin/social" className="text-xs text-muted-foreground hover:underline">
          Post queue
        </Link>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {shown.map((post) => (
          <figure key={post.id}>
            {post.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={post.imageUrl}
                alt={post.zoneName ? `${post.zoneName}, before and after` : "Before and after"}
                className="w-full rounded-lg border border-border object-cover"
                style={{ aspectRatio: "1080 / 1350" }}
              />
            ) : (
              <div
                className="w-full rounded-lg border border-dashed border-border"
                style={{ aspectRatio: "1080 / 1350" }}
              />
            )}
            <figcaption className="mt-1 text-xs text-muted-foreground">
              {post.zoneName && <span className="block truncate font-medium">{post.zoneName}</span>}
              <span className="flex items-center gap-1">
                {post.status === "posted" ? (
                  <>
                    <CheckCircle2 className="h-3 w-3" />
                    Posted
                  </>
                ) : (
                  <>
                    <CalendarClock className="h-3 w-3" />
                    {post.scheduledFor ? describeSlot(post.scheduledFor) : "Queued"}
                  </>
                )}
              </span>
            </figcaption>
          </figure>
        ))}
      </div>
    </section>
  );
}
