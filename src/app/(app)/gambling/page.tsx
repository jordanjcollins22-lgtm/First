import { redirect } from "next/navigation";

import { getCurrentProfile } from "@/lib/data/team";
import { isSupabaseConfigured } from "@/lib/env";
import { TieBoard } from "@/components/gambling/tie-board";
import {
  cashOutMultiple,
  SAMPLE_ACCOUNTS,
  SAMPLE_HALFTIME_BETS,
  type HalftimeBet,
} from "@/lib/gambling-sample-data";

/**
 * A layout test, not a product. Everything on this page is hardcoded sample
 * data — no book is connected, nothing is fetched, nothing is stored.
 */

function money(n: number): string {
  return n.toLocaleString(undefined, { style: "currency", currency: "USD" });
}

const STATUS_STYLES: Record<HalftimeBet["status"], string> = {
  offered: "border-sky-400/70 bg-sky-50/60 text-sky-900",
  taken: "border-emerald-400/70 bg-emerald-50/60 text-emerald-900",
  declined: "border-zinc-300 bg-zinc-50/60 text-zinc-600",
};

const STATUS_LABELS: Record<HalftimeBet["status"], string> = {
  offered: "Offer live",
  taken: "Cashed out",
  declined: "Let it ride",
};

export default async function GamblingPage() {
  if (!isSupabaseConfigured) redirect("/");

  // Same gate as the other admin screens — it's a scratch page, but there's no
  // reason for the whole crew to land on it.
  const profile = await getCurrentProfile();
  if (!profile?.roles.includes("admin")) redirect("/attractors");

  const totalBalance = SAMPLE_ACCOUNTS.reduce((sum, a) => sum + a.balance, 0);
  const totalStart = SAMPLE_ACCOUNTS.reduce((sum, a) => sum + a.startingBalance, 0);
  const totalAtRisk = SAMPLE_ACCOUNTS.reduce((sum, a) => sum + a.atRisk, 0);
  const net = totalBalance - totalStart;

  const liveOffers = SAMPLE_HALFTIME_BETS.filter((b) => b.status === "offered");
  const offerValue = liveOffers.reduce((sum, b) => sum + b.cashOutOffer, 0);
  const offerStake = liveOffers.reduce((sum, b) => sum + b.stake, 0);

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <h1 className="mb-1 text-2xl font-bold">Gambling</h1>
      <p className="mb-4 text-muted-foreground">
        Two tie-at-halftime plays a week, plus cash-out positions across every account.
      </p>

      <div className="mb-6 rounded-xl border-2 border-dashed border-amber-500/70 bg-amber-50/70 px-3 py-2.5">
        <p className="text-sm font-semibold">Sample data — none of this is real</p>
        <p className="text-xs text-muted-foreground">
          Every account, balance, game, score, and price on this page is invented for a layout test. Nothing is
          connected to FanDuel or any other book, and none of these games were played.
        </p>
      </div>

      <div className="mb-6">
        <TieBoard />
      </div>

      {/* Totals */}
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Tile label="Across 10 accounts" value={money(totalBalance)} />
        <Tile
          label="Up / down"
          value={`${net >= 0 ? "+" : ""}${money(net)}`}
          tone={net >= 0 ? "good" : "bad"}
        />
        <Tile label="Tied up in open bets" value={money(totalAtRisk)} />
        <Tile label="Live cash-out offers" value={money(offerValue)} hint={`on ${money(offerStake)} staked`} />
      </div>

      {/* Halftime board */}
      <section className="mb-6 rounded-xl border border-white/60 bg-card/60 p-4 backdrop-blur-md">
        <h2 className="mb-1 text-sm font-semibold">Halftime board</h2>
        <p className="mb-3 text-xs text-muted-foreground">
          Every open ticket at the half, with what the book is offering to buy it back for.
        </p>

        {/* Phone gets cards; the seven-column table starts at sm. */}
        <ul className="flex flex-col gap-2 sm:hidden">
          {SAMPLE_HALFTIME_BETS.map((bet) => {
            const multiple = cashOutMultiple(bet);
            return (
              <li key={bet.id} className="rounded-lg border border-border p-2.5">
                <div className="flex items-baseline justify-between gap-2">
                  <p className="font-medium">{bet.matchup}</p>
                  <span
                    className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-medium ${
                      STATUS_STYLES[bet.status]
                    }`}
                  >
                    {STATUS_LABELS[bet.status]}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">{bet.halftimeScore}</p>
                <p className="text-xs text-muted-foreground">
                  {bet.person} · {bet.market}
                </p>
                <div className="mt-1 flex items-baseline justify-between gap-2 text-sm">
                  <span className="text-xs text-muted-foreground">
                    {money(bet.stake)} staked
                  </span>
                  <span className="font-semibold tabular-nums">
                    {money(bet.cashOutOffer)}{" "}
                    <span className={multiple >= 1 ? "text-emerald-700" : "text-destructive"}>
                      ({multiple.toFixed(2)}×)
                    </span>
                  </span>
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
                <th className="py-1.5 pr-3 font-medium">Who</th>
                <th className="py-1.5 pr-3 font-medium">Bet</th>
                <th className="py-1.5 pr-3 text-right font-medium">Stake</th>
                <th className="py-1.5 pr-3 text-right font-medium">Cash out</th>
                <th className="py-1.5 pr-3 text-right font-medium">×</th>
                <th className="py-1.5 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {SAMPLE_HALFTIME_BETS.map((bet) => {
                const multiple = cashOutMultiple(bet);
                return (
                  <tr key={bet.id} className="border-b border-border/60 last:border-0">
                    <td className="py-2 pr-3">
                      <p className="font-medium">{bet.matchup}</p>
                      <p className="text-xs text-muted-foreground">{bet.halftimeScore}</p>
                    </td>
                    <td className="py-2 pr-3">{bet.person}</td>
                    <td className="py-2 pr-3 text-xs">{bet.market}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{money(bet.stake)}</td>
                    <td className="py-2 pr-3 text-right font-semibold tabular-nums">{money(bet.cashOutOffer)}</td>
                    <td
                      className={`py-2 pr-3 text-right tabular-nums ${
                        multiple >= 1 ? "text-emerald-700" : "text-destructive"
                      }`}
                    >
                      {multiple.toFixed(2)}×
                    </td>
                    <td className="py-2">
                      <span
                        className={`inline-block rounded-full border px-2 py-0.5 text-[11px] font-medium ${
                          STATUS_STYLES[bet.status]
                        }`}
                      >
                        {STATUS_LABELS[bet.status]}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <p className="mt-3 text-[11px] text-muted-foreground">
          The multiple is the offer divided by the stake. Two of the rows above sit well under 1× — a cash-out offer
          tracks how the game is actually going, so a position that is losing at the half gets offered back for less
          than it cost.
        </p>
      </section>

      {/* Accounts */}
      <section className="rounded-xl border border-white/60 bg-card/60 p-4 backdrop-blur-md">
        <h2 className="mb-3 text-sm font-semibold">Accounts</h2>
        <ul className="grid gap-2 sm:grid-cols-2">
          {SAMPLE_ACCOUNTS.map((account) => {
            const change = account.balance - account.startingBalance;
            const up = change >= 0;
            return (
              <li key={account.id} className="rounded-lg border border-border p-2.5">
                <div className="flex items-baseline justify-between gap-3">
                  <p className="text-sm font-medium">{account.person}</p>
                  <p className="text-sm font-semibold tabular-nums">{money(account.balance)}</p>
                </div>
                <div className="flex items-baseline justify-between gap-3 text-xs">
                  <span className="text-muted-foreground">{money(account.atRisk)} in open bets</span>
                  <span className={`tabular-nums ${up ? "text-emerald-700" : "text-destructive"}`}>
                    {up ? "+" : ""}
                    {money(change)}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
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
    <div className="rounded-xl border border-white/60 bg-card/60 p-3 backdrop-blur-md">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p
        className={`text-xl font-bold tabular-nums ${
          tone === "good" ? "text-emerald-700" : tone === "bad" ? "text-destructive" : ""
        }`}
      >
        {value}
      </p>
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}
