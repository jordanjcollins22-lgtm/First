import type { ReferralRow } from "@/lib/data/referrals";

/** The people an affiliate sent their link to, and whether each one opened it. */
export function ReferralList({ rows }: { rows: ReferralRow[] }) {
  if (rows.length === 0) return null;
  return (
    <div className="grid gap-1">
      <p className="text-sm font-semibold">People you sent it to</p>
      <ul className="divide-y divide-border rounded-xl border bg-card text-sm">
        {rows.map((r, i) => (
          <li key={i} className="flex items-center justify-between gap-2 px-3 py-2">
            <span className="min-w-0 truncate">
              <span className="font-medium">{r.name}</span>
              <span className="ml-1 text-xs text-muted-foreground">· {r.affiliation}{r.screenshot ? " · screenshot" : ""}</span>
            </span>
            <span className={r.clicks > 0 ? "shrink-0 text-xs font-semibold text-emerald-700 dark:text-emerald-400" : "shrink-0 text-xs text-muted-foreground"}>
              {r.clicks > 0 ? "Opened your link" : "Not opened yet"}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
