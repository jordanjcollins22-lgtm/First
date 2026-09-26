import type { AnswererStanding } from "@/lib/data/post-board";

/**
 * The answering leaderboard, under the comment card.
 *
 * Bookings first, because that is the point of a comment; then comments this
 * week, all time, the opens their links got, and the posts they found.
 */
export function AnsweringLeaderboard({ standings, meId }: { standings: AnswererStanding[]; meId: string }) {
  return (
    <section className="mx-auto w-full max-w-md rounded-2xl border border-border bg-card p-4">
      <h2 className="mb-2 text-sm font-semibold">Leaderboard</h2>
      {standings.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nobody has answered a post yet. The first comment puts you on top.</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wide text-muted-foreground">
              <th className="pb-1 font-medium">#</th>
              <th className="pb-1 font-medium">Name</th>
              <th className="pb-1 text-right font-medium" title="Comments posted in the last 7 days">7 days</th>
              <th className="pb-1 text-right font-medium" title="Comments posted, all time">All</th>
              <th className="pb-1 text-right font-medium" title="Opens of the links in their comments">Clicks</th>
              <th className="pb-1 text-right font-medium" title="Evaluations booked through their links">Booked</th>
              <th className="pb-1 text-right font-medium" title="Posts they found and added">Found</th>
            </tr>
          </thead>
          <tbody>
            {standings.map((s, i) => (
              <tr key={s.profileId} className={`border-t border-border/60 ${s.profileId === meId ? "font-semibold text-primary" : ""}`}>
                <td className="py-1.5 tabular-nums text-muted-foreground">{i + 1}</td>
                <td className="py-1.5">
                  {s.name}
                  {s.profileId === meId ? " (you)" : ""}
                </td>
                <td className="py-1.5 text-right tabular-nums">{s.week}</td>
                <td className="py-1.5 text-right tabular-nums">{s.allTime}</td>
                <td className="py-1.5 text-right tabular-nums">{s.clicks}</td>
                <td className="py-1.5 text-right tabular-nums">{s.booked}</td>
                <td className="py-1.5 text-right tabular-nums">{s.found}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
