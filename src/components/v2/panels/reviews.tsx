import { cache } from "react";
import { Star } from "lucide-react";

import { loadReviewsPanel } from "@/lib/data/marketing-panels";

import { DraftReplyButton, HeldReplyCard } from "./marketing-autopilot-controls";
import { OpenInDrawer } from "./marketing-open";
import { Kpi, NotConnected, pct, Section } from "./marketing-panel-parts";

/**
 * Marketing › Digital marketing › Reviews: Google reviews as they arrive,
 * the replies the app posted, and the ones it is holding for a person
 * (three stars or fewer, or a reply Google refused). The held ones sit under
 * Needs you, the rest under Google & reviews; the switch is under Automatic.
 */

const STATUS_LABEL: Record<string, string> = {
  none: "Not answered",
  drafted: "Drafted",
  held: "Waiting for you",
  posted: "Replied by the app",
  failed: "Reply failed",
  skipped: "Left without a reply",
  existing: "Answered on Google",
};

/** One load for both review screens on the request. */
const loadReviews = cache(() => loadReviewsPanel());

function Stars({ n }: { n: number | null }) {
  if (n == null) return <span className="text-xs text-muted-foreground">no stars</span>;
  return (
    <span className="flex gap-0.5 text-amber-500" aria-label={`${n} stars`}>
      {Array.from({ length: n }, (_, i) => (
        <Star key={i} className="h-3.5 w-3.5 fill-current" />
      ))}
    </span>
  );
}

/** The replies held for a person, to edit and post. Nothing at all when none are held. */
export async function ReviewsWaitingPanel() {
  const d = await loadReviews();
  if (d.held.length === 0) return <></>;

  return (
    <Section title="Replies waiting for you" hint="Edit if you like, then post. These were not sent because they are 3 stars or fewer, or Google refused the reply.">
      <ul className="grid gap-3">
        {d.held.map((r) => (
          <li key={r.id} className="grid gap-2 rounded-xl border bg-card p-3">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="font-semibold">{r.author ?? "A Google user"}</span>
              <Stars n={r.stars} />
              {r.reviewedAt && <span className="text-xs text-muted-foreground">{new Date(r.reviewedAt).toLocaleDateString()}</span>}
            </div>
            {r.body && <p className="text-sm text-muted-foreground">&ldquo;{r.body}&rdquo;</p>}
            <HeldReplyCard id={r.id} draft={r.replyDraft ?? ""} error={r.replyError} />
          </li>
        ))}
      </ul>
    </Section>
  );
}

/** The rating against target, and the reviews as they arrive with the app's replies. */
export async function ReviewsPanel() {
  const d = await loadReviews();

  return (
    <div className="grid gap-4">
      {!d.connected && <NotConnected what="Google Business Profile" />}
      {!d.connected && d.lastError && <p className="text-sm text-destructive">Google Business Profile has a problem: {d.lastError}</p>}

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Kpi label="Rating" value={d.stats.average != null ? d.stats.average.toFixed(1) : "—"} target="≥ 4.7" tone={d.stats.average == null ? "none" : d.stats.average >= 4.7 ? "good" : "warn"} />
        <Kpi label="Reviews" value={String(d.stats.count)} />
        <Kpi label="New, last 30 days" value={String(d.stats.last30)} target="4–10" tone={!d.connected ? "none" : d.stats.last30 >= 4 ? "good" : "warn"} />
        <Kpi label="Answered" value={pct(d.stats.responseRate)} target="100%" tone={d.stats.responseRate == null ? "none" : d.stats.responseRate >= 0.99 ? "good" : "warn"} />
      </div>

      <Section title="Recent reviews" hint="Pulled from Google every morning. Four and five stars with words also go on the booking page and the website on their own.">
        {d.recent.length === 0 ? (
          <p className="text-sm text-muted-foreground">{d.connected ? "No reviews pulled yet. They arrive with the next morning's run." : "Nothing yet: connect Google Business Profile to pull reviews in."}</p>
        ) : (
          <ul className="grid gap-2">
            {d.recent.map((r) => (
              <li key={r.id} className="grid gap-1.5 rounded-lg border bg-card p-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">{r.author ?? "A Google user"}</span>
                  <Stars n={r.stars} />
                  <span className="ml-auto text-xs text-muted-foreground">{STATUS_LABEL[r.replyStatus] ?? r.replyStatus}</span>
                  <OpenInDrawer entity={{ kind: "mkt.review", id: r.id }} className="inline-flex min-h-8 items-center gap-0.5 rounded-lg px-2 text-xs font-semibold hover:bg-muted">
                    Open
                  </OpenInDrawer>
                </div>
                {r.body && <p className="text-muted-foreground">{r.body}</p>}
                {r.replyBody && <p className="border-l-2 pl-2 text-xs">Reply: {r.replyBody}</p>}
                {r.replyStatus === "none" && d.connected && <DraftReplyButton id={r.id} />}
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}
