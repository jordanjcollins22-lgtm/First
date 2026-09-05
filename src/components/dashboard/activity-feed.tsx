import Link from "next/link";

import { activityHeadline, type ActivityItem } from "@/lib/activity";

function time(at: string): string {
  return new Date(at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function day(at: string): string {
  return new Date(at).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

/**
 * What the crew did, in the order they did it.
 *
 * The piles above say where each job stands. This says how it got there — left
 * the shop at 7:10, on site at 7:52, paused at 10:15 waiting on a delivery.
 * The pause is the line this exists for: it is the only one nobody would find
 * out about otherwise until somebody rang to ask why the job was not done.
 *
 * Grouped by day so a week's worth still reads chronologically, and every line
 * that touches a job links to it, because the next thing anybody does after
 * reading "paused" is open the job.
 */
export function ActivityFeed({ items, showDays }: { items: ActivityItem[]; showDays: boolean }) {
  const groups: { key: string; items: ActivityItem[] }[] = [];
  for (const item of items) {
    const key = showDays ? day(item.at) : "";
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.items.push(item);
    else groups.push({ key, items: [item] });
  }

  return (
    <section className="mb-6">
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <h2 className="text-lg font-bold">Activity</h2>
        <span className="text-xs text-muted-foreground">{activityHeadline(items)}</span>
      </div>
      <p className="mb-2 text-xs text-muted-foreground">
        Every tap the crew makes — leaving the shop, arriving, starting, pausing, finishing — plus walks and
        sign-offs.
      </p>

      {items.length === 0 ? (
        <p className="rounded-xl border border-white/60 bg-card/60 px-3 py-3 text-sm text-muted-foreground backdrop-blur-md">
          Nothing logged in this window yet. Lines appear here the moment somebody taps a button on Today.
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {groups.map((group) => (
            <div key={group.key || "all"}>
              {group.key && (
                <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {group.key}
                </p>
              )}
              <ul className="flex flex-col gap-1.5">
                {group.items.map((item) => {
                  const body = (
                    <>
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="truncate font-medium">{item.text}</span>
                        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                          {time(item.at)}
                        </span>
                      </div>
                      <p className="truncate text-xs text-muted-foreground">
                        {[item.personName, item.jobLabel].filter(Boolean).join(" · ") || "—"}
                      </p>
                      {item.detail && <p className="mt-0.5 text-xs italic">{item.detail}</p>}
                    </>
                  );

                  // A thick left edge rather than a tint alone: the page sits
                  // on a green gradient, and a pale amber wash on top of it is
                  // exactly the thing an eye skims past. The pause is the line
                  // this feed exists for.
                  const className = `block rounded-lg border p-2.5 backdrop-blur-md ${
                    item.attention
                      ? "border-amber-400/70 border-l-4 border-l-amber-500 bg-amber-50/80"
                      : "border-white/60 bg-card/60"
                  }`;

                  return (
                    <li key={item.id}>
                      {item.jobId ? (
                        <Link href={`/jobs/${item.jobId}`} className={`${className} hover:bg-accent/50`}>
                          {body}
                        </Link>
                      ) : (
                        <div className={className}>{body}</div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
