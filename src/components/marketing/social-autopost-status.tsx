import type { Health } from "@/lib/social/autopost";
import { PLATFORM_LABEL, SOCIAL_PLATFORMS, slotLabel, type SocialCadence } from "@/lib/social/cadence";
import type { UpcomingPost } from "@/lib/data/social-autopost";
import { shortWhen } from "@/lib/time-zone";

/**
 * The posting job's health, in one box: last posted, next post, and what is
 * wrong if anything is. Shared by Admin › Social and the preview review page.
 */
export function PostingHealthCard({ health, id }: { health: Health; id?: string }) {
  const tone =
    health.tone === "good"
      ? "border-emerald-300 bg-emerald-50 text-emerald-950 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-100"
      : health.tone === "warn"
        ? "border-amber-300 bg-amber-50 text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100"
        : "border-red-300 bg-red-50 text-red-950 dark:border-red-800 dark:bg-red-950/40 dark:text-red-100";
  return (
    <section id={id} className={`rounded-lg border p-4 text-sm ${tone}`}>
      <h3 className="font-semibold">{health.headline}</h3>
      <ul className="mt-2 list-disc space-y-1 pl-5">
        {health.lines.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    </section>
  );
}

export function CadenceSummary({ cadence }: { cadence: SocialCadence }) {
  return (
    <ul className="space-y-1 text-sm">
      {SOCIAL_PLATFORMS.map((p) => (
        <li key={p}>
          <span className="font-medium">{PLATFORM_LABEL[p]}:</span> {cadence.perWeek[p]} a week
          {cadence.perWeek[p] > 0 && <> · {cadence.slots.slice(0, cadence.perWeek[p]).map(slotLabel).join(", ")}</>}
        </li>
      ))}
      <li className="text-muted-foreground">
        Times are Eastern. Approved posts {cadence.autofill ? "get the next free slot by themselves" : "wait for a time to be set by hand"}.
      </li>
    </ul>
  );
}

const STATUS_LABEL: Record<string, string> = { scheduled: "Scheduled", approved: "Waiting for a slot", failed: "Failed", posted: "Posted" };

const platformName = (x: string) => PLATFORM_LABEL[x as keyof typeof PLATFORM_LABEL] ?? x;

export function UpcomingList({ posts, actions }: { posts: UpcomingPost[]; actions?: (post: UpcomingPost) => React.ReactNode }) {
  if (posts.length === 0) return <p className="text-sm text-muted-foreground">Nothing in the queue.</p>;
  return (
    <ul className="divide-y divide-border rounded-lg border border-border text-sm">
      {posts.map((p) => (
        <li key={p.id} className="flex flex-wrap items-start justify-between gap-2 p-3">
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium">{p.hook || "(no text yet)"}</p>
            <p className="text-xs text-muted-foreground">
              {STATUS_LABEL[p.status] ?? p.status}
              {p.scheduledFor ? ` · ${shortWhen(p.scheduledFor)}` : ""}
              {p.sent ? "" : ` · ${p.platforms.map(platformName).join(" + ")}`}
              {p.attempts > 0 ? ` · tried ${p.attempts}×` : ""}
            </p>
            {p.sent && (
              <p className="mt-1 flex flex-wrap gap-x-3 text-xs font-medium">
                {p.platforms.map((x) =>
                  p.sent!.includes(x) ? (
                    <span key={x} className="text-emerald-700 dark:text-emerald-300">
                      {platformName(x)} ✓
                    </span>
                  ) : (
                    <span key={x} className={p.status === "failed" ? "text-red-700 dark:text-red-300" : "text-muted-foreground"}>
                      {platformName(x)} {p.status === "failed" ? "✕" : "…"}
                    </span>
                  )
                )}
              </p>
            )}
            {p.lastError && <p className="mt-1 text-xs text-red-700 dark:text-red-300">{p.lastError}</p>}
          </div>
          {actions?.(p)}
        </li>
      ))}
    </ul>
  );
}
