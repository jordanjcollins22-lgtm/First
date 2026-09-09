import { STATE_LABELS } from "@/lib/commission";
import type { JobCommission } from "@/lib/data/commission";

function money(n: number): string {
  return n.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 2 });
}

/**
 * What this one project is worth to the person managing it, and whether it
 * has been paid.
 *
 * On the job rather than on the money screen, because that is where the
 * question is asked. An account manager standing on a project is not going to
 * navigate to a finance page to find out what it earned them, so they never
 * found out.
 */
export function JobCommissionPanel({ commission }: { commission: JobCommission }) {
  const { line, payouts, mine, managerName } = commission;
  const paidInFull = line.state === "paid";

  return (
    <section
      className={`rounded-xl border p-3 ${
        paidInFull
          ? "border-border/60 bg-background/50"
          : line.state === "held"
            ? "border-amber-400/70 bg-amber-50/60"
            : "border-border bg-card/60"
      }`}
    >
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold">{mine ? "Your commission" : `${managerName}'s commission`}</h3>
        <span className="text-xs text-muted-foreground">{line.pct}% of collected</span>
      </div>

      <p className="mt-1 flex items-baseline gap-2">
        <span className="text-2xl font-bold tabular-nums">{money(paidInFull ? line.paidOut : line.amount)}</span>
        <span
          className={`text-xs font-semibold ${
            line.state === "earned"
              ? "text-emerald-700"
              : line.state === "held"
                ? "text-amber-800"
                : "text-muted-foreground"
          }`}
        >
          {STATE_LABELS[line.state]}
        </span>
      </p>

      <p className="text-xs text-muted-foreground">
        {money(line.collected)} collected
        {line.outstanding > 0 ? `, ${money(line.outstanding)} still out` : ""}
        {line.paidOut > 0 && !paidInFull ? `, ${money(line.paidOut)} already paid` : ""}
      </p>
      {line.reason && <p className="mt-0.5 text-xs text-muted-foreground">{line.reason}</p>}

      {payouts.length > 0 && (
        <ul className="mt-2 flex flex-col gap-0.5 border-t border-border/60 pt-2">
          {payouts.map((payout) => (
            <li key={payout.id} className="flex items-baseline justify-between gap-2 text-[11px]">
              <span className="text-muted-foreground">
                Paid {new Date(payout.paidAt).toLocaleDateString()}
                {payout.reference ? ` · ${payout.reference}` : ""}
              </span>
              <span className="shrink-0 tabular-nums">{money(payout.amount)}</span>
            </li>
          ))}
        </ul>
      )}

      {!paidInFull && line.state === "earned" && (
        <p className="mt-2 text-[11px] text-muted-foreground">
          Payable. It is recorded as paid on the Money screen, by whoever sends it.
        </p>
      )}
    </section>
  );
}
