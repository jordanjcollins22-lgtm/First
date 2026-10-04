import Link from "next/link";
import { ArrowRight, Users } from "lucide-react";

import type { StageRoster } from "@/lib/data/stage-roster";

const when = (iso: string) =>
  new Date(iso).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/New_York" });

/**
 * Everybody at this step now: the last of its messages they got, the next
 * one due and when, and the step they move on to once these are done.
 */
export function StageRosterPanel({ roster, stepTitle }: { roster: StageRoster; stepTitle: string }) {
  return (
    <section className="mb-6 rounded-2xl border border-border bg-card p-4">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="flex items-center gap-1.5 text-lg font-bold">
          <Users className="h-4 w-4" /> At {stepTitle} now
        </h2>
        <span className="text-sm tabular-nums text-muted-foreground">{roster.rows.length}</span>
      </div>
      <p className="text-xs text-muted-foreground">{roster.who}</p>

      {roster.rows.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">Nobody is at this step right now.</p>
      ) : (
        <ul className="mt-3 flex flex-col divide-y divide-border">
          {roster.rows.map((r) => (
            <li key={r.jobId} className="flex flex-col gap-0.5 py-2.5">
              <Link href={`/jobs/${r.jobId}`} className="font-semibold hover:underline">
                {r.client}
              </Link>
              <p className="text-xs text-muted-foreground">
                {r.had ? (
                  <>
                    Got <span className="font-medium text-foreground">{r.had.number}</span> {r.had.label} · {when(r.had.at)}
                  </>
                ) : (
                  "No message at this step yet"
                )}
              </p>
              <p className="flex items-center gap-1 text-xs">
                <ArrowRight className="h-3 w-3 shrink-0 text-primary" />
                {r.next ? (
                  <span>
                    Next: <span className="font-medium">{r.next.number}</span> {r.next.label}
                    {r.next.byHand ? " · sent by the account manager" : r.next.at ? ` · ${when(r.next.at)}` : ""}
                  </span>
                ) : (
                  <span>Messages here are done{roster.nextStep ? `. Next step: ${roster.nextStep}` : ""}</span>
                )}
              </p>
            </li>
          ))}
        </ul>
      )}
      {roster.nextStep && <p className="mt-2 text-[11px] text-muted-foreground">After this step they move on to {roster.nextStep}.</p>}
    </section>
  );
}
