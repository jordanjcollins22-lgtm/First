"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";

import { POST_STAGES, type PostStage } from "@/lib/affiliate-closes";
import type { AnsweredPost } from "@/lib/data/post-board";

const STAGE_STYLE: Record<PostStage, string> = {
  waiting: "bg-muted text-muted-foreground",
  clicked: "bg-sky-100 text-sky-800 dark:bg-sky-500/20 dark:text-sky-300",
  evaluation: "bg-amber-100 text-amber-900 dark:bg-amber-500/20 dark:text-amber-200",
  proposal: "bg-violet-100 text-violet-800 dark:bg-violet-500/20 dark:text-violet-300",
  closed: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300",
  said_no: "bg-red-100 text-red-800 dark:bg-red-500/20 dark:text-red-300",
};

const LABEL = new Map(POST_STAGES.map((s) => [s.key, s.label]));

const PLATFORM: Record<string, string> = { facebook: "Facebook", nextdoor: "Nextdoor", reddit: "Reddit", instagram: "Instagram", x: "X" };

function money(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

function day(iso: string): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" });
}

/**
 * Under the leaderboard: every post somebody answered with their link, and
 * where each got to. Their own pipeline, from the comment to the close.
 */
export function AnsweredPosts({ posts, whose }: { posts: AnsweredPost[]; whose: string | null }) {
  const [only, setOnly] = useState<PostStage | null>(null);
  const counts = new Map<PostStage, number>();
  for (const p of posts) counts.set(p.stage, (counts.get(p.stage) ?? 0) + 1);
  const shown = only ? posts.filter((p) => p.stage === only) : posts;
  // The headline numbers, so the closed drop-down still says how it is going.
  const summary = [
    `${posts.length} answered`,
    // Booked counts everything that got as far as an evaluation, closed or not.
    (() => {
      const booked = (counts.get("evaluation") ?? 0) + (counts.get("proposal") ?? 0) + (counts.get("closed") ?? 0) + (counts.get("said_no") ?? 0);
      return booked ? `${booked} booked` : null;
    })(),
    counts.get("closed") ? `${counts.get("closed")} closed` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    // Closed until opened, so the card above stays the first thing on the
    // page. Somebody else's list, opened from the leaderboard, starts open.
    <details id="answered" open={Boolean(whose)} className="group mx-auto w-full max-w-md scroll-mt-4 rounded-2xl border border-border bg-card p-4">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 [&::-webkit-details-marker]:hidden">
        <span className="min-w-0">
          <span className="block text-sm font-semibold">{whose ? `${whose}'s answered posts` : "Your answered posts"}</span>
          <span className="block truncate text-xs text-muted-foreground">{posts.length > 0 ? summary : "Nothing answered yet"}</span>
        </span>
        <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
      </summary>
      <div className="mt-3">
      <p className="mb-3 text-xs text-muted-foreground">Every post answered with a link, and where it got to.</p>

      {posts.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing answered yet. Respond to the post above and it shows here.</p>
      ) : (
        <>
          <div className="mb-3 flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => setOnly(null)}
              className={`rounded-full border px-2.5 py-1 text-xs ${only === null ? "border-primary bg-primary text-primary-foreground" : "border-border"}`}
            >
              All {posts.length}
            </button>
            {POST_STAGES.filter((s) => counts.has(s.key)).map((s) => (
              <button
                key={s.key}
                type="button"
                onClick={() => setOnly(only === s.key ? null : s.key)}
                className={`rounded-full border px-2.5 py-1 text-xs ${only === s.key ? "border-primary bg-primary text-primary-foreground" : "border-border"}`}
              >
                {s.label} {counts.get(s.key)}
              </button>
            ))}
          </div>

          <ul className="divide-y divide-border/60">
            {shown.map((p) => (
              <li key={p.id} className="py-2.5">
                <div className="flex items-start justify-between gap-3">
                  <p className="line-clamp-2 text-sm">{p.about}</p>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${STAGE_STYLE[p.stage]}`}>{LABEL.get(p.stage)}</span>
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {[
                    day(p.answeredAt),
                    p.kind === "booking" ? null : `${PLATFORM[p.platform] ?? "Other"} ${p.kind === "dm" ? "message" : p.kind}`,
                    p.kind === "booking" ? null : `${p.clicks} click${p.clicks === 1 ? "" : "s"}`,
                    p.client,
                    p.amount != null && p.stage !== "said_no" ? money(p.amount) : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
                {(p.postUrl || p.comment) && (
                  <div className="mt-1 flex flex-wrap gap-x-3 text-xs">
                    {p.postUrl && (
                      <a href={p.postUrl} target="_blank" rel="noreferrer" className="font-medium text-primary hover:underline">
                        Open the post
                      </a>
                    )}
                    {p.comment && (
                      <details className="w-full">
                        <summary className="cursor-pointer text-muted-foreground">What you wrote</summary>
                        <p className="mt-1 whitespace-pre-wrap text-muted-foreground">{p.comment}</p>
                      </details>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
      </div>
    </details>
  );
}
