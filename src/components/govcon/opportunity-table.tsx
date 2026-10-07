import Link from "next/link";

import type { OpportunityListItem } from "@/lib/data/govcon";
import { TRADE_BY_KEY } from "@/lib/govcon/trades";
import type { TradeKey } from "@/lib/govcon/types";

import { StatusBadge } from "./status-badge";

export function daysLeft(deadline: string | null): string {
  if (!deadline) return "—";
  const d = Math.floor((Date.parse(deadline) - Date.now()) / 86_400_000);
  return d < 0 ? "closed" : d === 0 ? "today" : `${d}d`;
}

export function OpportunityTable({ rows, empty }: { rows: OpportunityListItem[]; empty: string }) {
  if (!rows.length) return <p className="py-4 text-sm text-muted-foreground">{empty}</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-left text-xs uppercase text-muted-foreground">
          <tr>
            <th className="py-2 pr-3">Score</th>
            <th className="py-2 pr-3">Opportunity</th>
            <th className="py-2 pr-3">Trade</th>
            <th className="py-2 pr-3">Where</th>
            <th className="py-2 pr-3">Due</th>
            <th className="py-2">Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((o) => (
            <tr key={o.id} className="border-t border-border align-top">
              <td className="py-2 pr-3 font-semibold tabular-nums">{o.score}</td>
              <td className="py-2 pr-3">
                <Link href={`/govcon/opportunities/${o.id}`} className="font-medium hover:text-primary">
                  {o.title}
                </Link>
                <div className="text-xs text-muted-foreground">
                  {o.agency}
                  {o.set_aside_label ? ` · ${o.set_aside_label}` : ""}
                </div>
                {o.last_error && <div className="text-xs text-destructive">{o.last_error}</div>}
              </td>
              <td className="py-2 pr-3 whitespace-nowrap">{o.trade ? TRADE_BY_KEY[o.trade as TradeKey]?.label ?? o.trade : "—"}</td>
              <td className="py-2 pr-3 whitespace-nowrap">{[o.pop_city, o.pop_state].filter(Boolean).join(", ") || "—"}</td>
              <td className="py-2 pr-3 whitespace-nowrap tabular-nums">{daysLeft(o.response_deadline)}</td>
              <td className="py-2">
                <StatusBadge status={o.status} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
