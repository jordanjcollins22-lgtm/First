import { categoryLabel } from "@/lib/post-sorting";
import type { PostInsights } from "@/lib/data/post-board";

/**
 * What the posts say about the area, over the last month: how many of each
 * kind the finder read, what people asked to have done and where, and for
 * our own work how much was answered and booked.
 */
export function PostInsightsCard({ insights }: { insights: PostInsights }) {
  if (insights.total === 0) {
    return (
      <section className="rounded-2xl border border-border bg-card p-4">
        <h2 className="text-sm font-semibold">What people are asking for</h2>
        <p className="mt-1 text-sm text-muted-foreground">Nothing sorted yet. Start finding posts and this fills in.</p>
      </section>
    );
  }
  const ours = insights.byCategory.find((c) => c.category === "for-us")?.count ?? 0;
  const max = Math.max(...insights.services.map((s) => s.count), 1);

  return (
    <section className="rounded-2xl border border-border bg-card p-4">
      <h2 className="text-sm font-semibold">What people are asking for</h2>
      <p className="mb-3 text-xs text-muted-foreground">
        The last {insights.days} days: {insights.total} posts read, {ours} for the affiliates. The rest is kept here as data.
      </p>

      <div className="mb-4 flex flex-wrap gap-1.5">
        {insights.byCategory.map((c) => (
          <span
            key={c.category}
            className={`rounded-full px-2.5 py-1 text-xs ${c.category === "for-us" ? "bg-primary text-primary-foreground" : "bg-muted text-foreground"}`}
          >
            {categoryLabel(c.category)} <span className="font-semibold">{c.count}</span>
          </span>
        ))}
      </div>

      {insights.services.length > 0 && (
        <>
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Asked for</p>
          <ul className="mb-4 space-y-1.5">
            {insights.services.map((s) => (
              <li key={s.service} className="text-sm">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="truncate">
                    {s.service}
                    {!s.ours && <span className="ml-1 text-xs text-muted-foreground">(not ours)</span>}
                  </span>
                  <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                    {s.count}
                    {s.ours ? ` · ${s.answered} answered · ${s.booked} booked` : ""}
                  </span>
                </div>
                <div className="mt-0.5 h-1.5 rounded-full bg-muted">
                  <div className={`h-1.5 rounded-full ${s.ours ? "bg-primary" : "bg-muted-foreground/40"}`} style={{ width: `${(s.count / max) * 100}%` }} />
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      {insights.towns.length > 0 && (
        <p className="text-xs text-muted-foreground">
          <span className="font-semibold uppercase tracking-wide">Where: </span>
          {insights.towns.map((t) => `${t.town} (${t.count})`).join(", ")}
        </p>
      )}
    </section>
  );
}
