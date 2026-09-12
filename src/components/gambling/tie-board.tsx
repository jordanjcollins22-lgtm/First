import {
  breakEvenRate,
  CURRENT_WEEK,
  profitOn,
  SAMPLE_TIE_HISTORY,
  SAMPLE_TIE_SLATE,
} from "@/lib/gambling-sample-data";

/**
 * The weekly play: take the two best-priced "tied at halftime" markets on the
 * slate. Sample data throughout.
 *
 * The screen leads with break-even rate rather than payout, because at these
 * prices that's the number that decides whether the week is worth playing —
 * a bigger price is only better if it clears the rate it needs to hit.
 */

function money(n: number): string {
  return n.toLocaleString(undefined, { style: "currency", currency: "USD" });
}

function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

function odds(n: number): string {
  return n > 0 ? `+${n}` : String(n);
}

const STAKE = 50;

export function TieBoard() {
  // Best price first — that's the pick order, and the top two are the plays.
  const slate = [...SAMPLE_TIE_SLATE].sort((a, b) => b.tieOdds - a.tieOdds);
  const picks = slate.slice(0, 2);

  // Season so far.
  const allPicks = SAMPLE_TIE_HISTORY.flatMap((w) => w.picks.map((p) => ({ ...p, stake: w.stakePerBet })));
  const betsPlaced = allPicks.length;
  const hits = allPicks.filter((p) => p.tied).length;
  const staked = allPicks.reduce((sum, p) => sum + p.stake, 0);
  const returned = allPicks.reduce(
    (sum, p) => sum + (p.tied ? p.stake + profitOn(p.stake, p.tieOdds) : 0),
    0
  );
  const net = returned - staked;
  const hitRate = betsPlaced > 0 ? hits / betsPlaced : 0;

  // Averaged across what we've actually bet, this is the rate the strategy has
  // to clear over the season to come out even.
  const avgBreakEven =
    allPicks.length > 0
      ? allPicks.reduce((sum, p) => sum + breakEvenRate(p.tieOdds), 0) / allPicks.length
      : 0;

  return (
    <div className="flex flex-col gap-4">
      {/* This week's two plays */}
      <section className="rounded-xl border border-white/60 bg-card/60 p-4 backdrop-blur-md">
        <h2 className="mb-1 text-sm font-semibold">Week {CURRENT_WEEK} — this week&apos;s two plays</h2>
        <p className="mb-3 text-xs text-muted-foreground">
          The two best-priced tie markets on the slate, {money(STAKE)} each.
        </p>

        <div className="grid gap-3 sm:grid-cols-2">
          {picks.map((game) => (
            <div key={game.id} className="rounded-lg border-2 border-primary/50 bg-primary/5 p-3">
              <div className="flex items-baseline justify-between gap-2">
                <p className="font-semibold">{game.matchup}</p>
                <p className="text-lg font-bold tabular-nums text-primary">{odds(game.tieOdds)}</p>
              </div>
              <p className="text-xs text-muted-foreground">{game.kickoff}</p>

              <dl className="mt-2 flex flex-col gap-0.5 text-xs">
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Pays if tied</dt>
                  <dd className="tabular-nums">{money(STAKE + profitOn(STAKE, game.tieOdds))}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Needs to hit</dt>
                  <dd className="tabular-nums">{pct(breakEvenRate(game.tieOdds))}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Our estimate</dt>
                  <dd
                    className={`tabular-nums ${
                      game.modelPct > breakEvenRate(game.tieOdds) ? "text-emerald-700" : "text-destructive"
                    }`}
                  >
                    {pct(game.modelPct)}
                  </dd>
                </div>
              </dl>

              <p className="mt-2 border-t border-border pt-2 text-xs text-muted-foreground">{game.reason}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Full slate */}
      <section className="rounded-xl border border-white/60 bg-card/60 p-4 backdrop-blur-md">
        <h2 className="mb-1 text-sm font-semibold">Full slate, best price first</h2>
        <p className="mb-3 text-xs text-muted-foreground">
          Edge is our estimate minus the rate the price needs. Positive is the only reason to take it.
        </p>

        {/* Phone: one card per game, since a six-column table on a 390px
            screen is a sideways scroll nobody performs. */}
        <ul className="flex flex-col gap-2 sm:hidden">
          {slate.map((game, i) => {
            const needs = breakEvenRate(game.tieOdds);
            const edge = game.modelPct - needs;
            return (
              <li key={game.id} className="rounded-lg border border-border p-2.5">
                <div className="flex items-baseline justify-between gap-2">
                  <p className="font-medium">{game.matchup}</p>
                  <p className="text-base font-bold tabular-nums">{odds(game.tieOdds)}</p>
                </div>
                <div className="flex items-baseline justify-between gap-2 text-xs text-muted-foreground">
                  <span>{game.kickoff}</span>
                  <span>
                    needs {pct(needs)} · ours {pct(game.modelPct)}
                  </span>
                </div>
                <div className="mt-1 flex items-center justify-between gap-2">
                  <span
                    className={`text-xs font-semibold tabular-nums ${
                      edge > 0 ? "text-emerald-700" : "text-destructive"
                    }`}
                  >
                    {edge > 0 ? "+" : ""}
                    {pct(edge)} edge
                  </span>
                  {i < 2 && (
                    <span className="rounded-full bg-primary px-2 py-0.5 text-[11px] font-semibold text-primary-foreground">
                      Play
                    </span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>

        <div className="hidden sm:block">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted-foreground">
                <th className="py-1.5 pr-3 font-medium">Game</th>
                <th className="py-1.5 pr-3 text-right font-medium">Tie odds</th>
                <th className="py-1.5 pr-3 text-right font-medium">Needs</th>
                <th className="py-1.5 pr-3 text-right font-medium">Ours</th>
                <th className="py-1.5 pr-3 text-right font-medium">Edge</th>
                <th className="py-1.5 font-medium" />
              </tr>
            </thead>
            <tbody>
              {slate.map((game, i) => {
                const needs = breakEvenRate(game.tieOdds);
                const edge = game.modelPct - needs;
                return (
                  <tr key={game.id} className="border-b border-border/60 last:border-0">
                    <td className="py-2 pr-3">
                      <p className="font-medium">{game.matchup}</p>
                      <p className="text-xs text-muted-foreground">{game.kickoff}</p>
                    </td>
                    <td className="py-2 pr-3 text-right font-semibold tabular-nums">{odds(game.tieOdds)}</td>
                    <td className="py-2 pr-3 text-right tabular-nums text-muted-foreground">{pct(needs)}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{pct(game.modelPct)}</td>
                    <td
                      className={`py-2 pr-3 text-right tabular-nums ${
                        edge > 0 ? "text-emerald-700" : "text-destructive"
                      }`}
                    >
                      {edge > 0 ? "+" : ""}
                      {pct(edge)}
                    </td>
                    <td className="py-2">
                      {i < 2 && (
                        <span className="rounded-full bg-primary px-2 py-0.5 text-[11px] font-semibold text-primary-foreground">
                          Play
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* Season tracker */}
      <section className="rounded-xl border border-white/60 bg-card/60 p-4 backdrop-blur-md">
        <h2 className="mb-3 text-sm font-semibold">Season so far</h2>

        <div className="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Tile label="Bets placed" value={String(betsPlaced)} hint={`${SAMPLE_TIE_HISTORY.length} weeks`} />
          <Tile label="Hit rate" value={pct(hitRate)} hint={`${hits} of ${betsPlaced}`} />
          <Tile label="Staked" value={money(staked)} />
          <Tile
            label="Net"
            value={`${net >= 0 ? "+" : ""}${money(net)}`}
            tone={net >= 0 ? "good" : "bad"}
          />
        </div>

        <ul className="flex flex-col gap-2">
          {SAMPLE_TIE_HISTORY.map((week) => {
            const weekStake = week.picks.length * week.stakePerBet;
            const weekReturn = week.picks.reduce(
              (sum, p) => sum + (p.tied ? week.stakePerBet + profitOn(week.stakePerBet, p.tieOdds) : 0),
              0
            );
            const weekNet = weekReturn - weekStake;
            return (
              <li key={week.week} className="rounded-lg border border-border p-2.5">
                <div className="flex items-baseline justify-between gap-3">
                  <p className="text-sm font-medium">Week {week.week}</p>
                  <p
                    className={`text-sm font-semibold tabular-nums ${
                      weekNet >= 0 ? "text-emerald-700" : "text-destructive"
                    }`}
                  >
                    {weekNet >= 0 ? "+" : ""}
                    {money(weekNet)}
                  </p>
                </div>
                {week.picks.map((pick) => (
                  <div
                    key={pick.matchup}
                    className="flex flex-wrap items-baseline justify-between gap-x-3 text-xs text-muted-foreground"
                  >
                    <span>
                      {pick.matchup} · {odds(pick.tieOdds)}
                    </span>
                    <span className={pick.tied ? "font-semibold text-emerald-700" : ""}>
                      {pick.halftimeScore} {pick.tied ? "· TIED" : ""}
                    </span>
                  </div>
                ))}
              </li>
            );
          })}
        </ul>

        <div className="mt-3 rounded-lg border border-border bg-background/50 p-3">
          <p className="text-xs font-semibold">The number that decides this</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            At the prices taken so far, the strategy has to hit{" "}
            <strong className="tabular-nums text-foreground">{pct(avgBreakEven)}</strong> of its bets just to break
            even. It is currently hitting{" "}
            <strong className="tabular-nums text-foreground">{pct(hitRate)}</strong> across {betsPlaced} bets — far
            too few to tell the two apart. NFL games sit level at the half somewhere around 8–9% of the time, which
            is close enough to the break-even rate that the margin in the price is doing most of the work. Track the
            gap between those two numbers over a full season; that gap, not the weekly net, is whether this works.
          </p>
        </div>
      </section>
    </div>
  );
}

function Tile({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "good" | "bad";
}) {
  return (
    <div className="rounded-lg border border-border p-2.5">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p
        className={`text-lg font-bold tabular-nums ${
          tone === "good" ? "text-emerald-700" : tone === "bad" ? "text-destructive" : ""
        }`}
      >
        {value}
      </p>
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}
