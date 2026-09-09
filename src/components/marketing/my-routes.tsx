import Link from "next/link";
import { Footprints, MapPin } from "lucide-react";

import { isApproved, type MarketingPlay } from "@/lib/marketing-plays";

/**
 * The rounds this person has been given.
 *
 * Approved ones only. A round waiting on somebody's approval is not work yet,
 * and putting it here would have people walking streets the business had not
 * agreed to walk.
 *
 * It sits on My Day rather than in Marketing because it is not a marketing
 * decision any more — it is a thing on somebody's day, next to their
 * evaluations and their jobs.
 */
export function MyRoutes({ plays }: { plays: MarketingPlay[] }) {
  const mine = plays.filter(
    (play) => play.status === "open" && isApproved(play.approval) && play.kind === "door_hangers"
  );
  if (mine.length === 0) return null;

  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold">Your rounds</h2>
      <ul className="space-y-2">
        {mine.map((play) => (
          <li key={play.id} className="rounded-xl border border-border bg-card/60 p-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="text-sm font-medium">{play.zoneName ?? "Door hangers"}</span>
              <span className="text-xs text-muted-foreground">
                {play.quantity} {play.quantity === 1 ? "door" : "doors"}
              </span>
            </div>
            <p className="mt-0.5 flex items-start gap-1 text-xs text-muted-foreground">
              <MapPin className="mt-0.5 h-3 w-3 shrink-0" />
              <span>
                Around {play.customerName ?? "a client"}
                {play.address ? ` · ${play.address}` : ""}
              </span>
            </p>
            <Link
              href={`/routes/${play.id}`}
              className="mt-2 inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground"
            >
              <Footprints className="h-4 w-4" /> Start route
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
