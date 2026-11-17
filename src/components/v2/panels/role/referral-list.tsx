import type { ReferralProgress, ReferralRow } from "@/lib/data/referrals";

const money = (n: number) => `$${n.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;

const STEPS: { key: ReferralProgress; label: string }[] = [
  { key: "sent", label: "Sent" },
  { key: "opened", label: "Opened" },
  { key: "booked", label: "Booked" },
  { key: "sold", label: "Sold" },
];

/** Sent, opened, booked, sold: how far they got, as four steps. */
function Progress({ row }: { row: ReferralRow }) {
  const progress = row.progress ?? (row.clicks > 0 ? "opened" : "sent");
  if (progress === "lost") return <span className="shrink-0 text-xs text-muted-foreground">Didn&apos;t go ahead</span>;
  const at = STEPS.findIndex((s) => s.key === progress);
  return (
    <span className="flex shrink-0 flex-col items-end gap-0.5">
      <span className="text-xs font-semibold text-emerald-700 dark:text-emerald-400">
        {STEPS[at].label}
        {progress === "sold" && row.yours != null ? ` · your 4%: ${money(row.yours)}` : ""}
      </span>
      <span className="flex gap-0.5" aria-hidden>
        {STEPS.map((s, i) => (
          <span key={s.key} className={i <= at ? "h-1.5 w-4 rounded-full bg-emerald-600" : "h-1.5 w-4 rounded-full bg-muted"} />
        ))}
      </span>
    </span>
  );
}

/** The people an affiliate sent their link to, and how far each one got. */
export function ReferralList({ rows, titled = true }: { rows: ReferralRow[]; titled?: boolean }) {
  if (rows.length === 0) return null;
  return (
    <div className="grid gap-1">
      {titled && <p className="text-sm font-semibold">People you sent it to</p>}
      <ul className="divide-y divide-border rounded-xl border bg-card text-sm">
        {rows.map((r, i) => (
          <li key={i} className="flex items-center justify-between gap-2 px-3 py-2">
            <span className="min-w-0 truncate">
              <span className="font-medium">{r.name}</span>
              <span className="ml-1 text-xs text-muted-foreground">· {r.affiliation}{r.screenshot ? " · screenshot" : ""}</span>
            </span>
            <Progress row={r} />
          </li>
        ))}
      </ul>
    </div>
  );
}
