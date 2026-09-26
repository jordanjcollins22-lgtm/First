import type { CloserStanding } from "@/lib/affiliate-closes";

function money(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

/**
 * The affiliate leaderboard, under the comment card: everybody who has put
 * affiliate links out, and what those links brought in and closed. Nothing
 * that came in another way is counted.
 */
export function AnsweringLeaderboard({ standings, meId }: { standings: CloserStanding[]; meId: string }) {
  return (
    <section className="mx-auto w-full max-w-md rounded-2xl border border-border bg-card p-4">
      <h2 className="mb-1 text-sm font-semibold">Leaderboard</h2>
      <p className="mb-2 text-xs text-muted-foreground">Only what came in through affiliate links.</p>
      {standings.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nobody has put an affiliate link out yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                <th className="pb-1 font-medium">#</th>
                <th className="pb-1 font-medium">Name</th>
                <th className="pb-1 text-right font-medium" title="Affiliate links they have put out">Links</th>
                <th className="pb-1 text-right font-medium" title="Jobs booked through their links">Booked</th>
                <th className="pb-1 text-right font-medium" title="Jobs from their links that sold">Closed</th>
                <th className="pb-1 text-right font-medium" title="What those jobs sold for">Sold for</th>
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
                  <td className="py-1.5 text-right tabular-nums">{s.links}</td>
                  <td className="py-1.5 text-right tabular-nums">{s.booked}</td>
                  <td className="py-1.5 text-right tabular-nums">{s.closed}</td>
                  <td className="py-1.5 text-right tabular-nums">{money(s.closedValue)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
