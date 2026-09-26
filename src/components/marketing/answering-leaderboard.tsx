import type { CloserStanding } from "@/lib/affiliate-closes";

function money(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

/**
 * The affiliate leaderboard, under the comment card: every affiliate and
 * what they have closed, best first. Sold work that is credited to nobody
 * is said underneath, for the owner, so it can be put on somebody.
 */
export function AnsweringLeaderboard({
  standings,
  unclaimed,
  meId,
  owner,
}: {
  standings: CloserStanding[];
  unclaimed: { closed: number; value: number };
  meId: string;
  owner: boolean;
}) {
  return (
    <section className="mx-auto w-full max-w-md rounded-2xl border border-border bg-card p-4">
      <h2 className="mb-1 text-sm font-semibold">Leaderboard</h2>
      <p className="mb-2 text-xs text-muted-foreground">Every affiliate and what they&apos;ve closed.</p>
      {standings.length === 0 ? (
        <p className="text-sm text-muted-foreground">No affiliates yet.</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wide text-muted-foreground">
              <th className="pb-1 font-medium">#</th>
              <th className="pb-1 font-medium">Name</th>
              <th className="pb-1 text-right font-medium" title="What the jobs they closed sold for">Closed</th>
              <th className="pb-1 text-right font-medium" title="Jobs closed">Jobs</th>
              <th className="pb-1 text-right font-medium" title="Closed in the last 30 days">30 days</th>
              <th className="pb-1 text-right font-medium" title="Comments posted from Posts to Answer">Comments</th>
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
                <td className="py-1.5 text-right tabular-nums">{money(s.closedValue)}</td>
                <td className="py-1.5 text-right tabular-nums">{s.closed}</td>
                <td className="py-1.5 text-right tabular-nums">{money(s.monthValue)}</td>
                <td className="py-1.5 text-right tabular-nums">{s.comments}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {owner && unclaimed.closed > 0 && (
        <p className="mt-2 text-xs text-amber-700">
          {unclaimed.closed} sold job{unclaimed.closed === 1 ? "" : "s"} ({money(unclaimed.value)}) {unclaimed.closed === 1 ? "isn't" : "aren't"} credited
          to anybody. Set who it&apos;s assigned to on the job page and it counts for them.
        </p>
      )}
    </section>
  );
}
