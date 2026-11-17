import Link from "next/link";
import { Suspense } from "react";
import { ChevronDown } from "lucide-react";

import { ClockControl } from "@/components/crew/clock-control";
import { Drop, StageCard } from "@/components/v2/panels/role/affiliate-home";
import { MyCalendarPanel } from "@/components/v2/panels/role/my-calendar";
import { SendLinkBlock } from "@/components/v2/panels/role/send-link-block";
import { WalletCard } from "@/components/v2/panels/role/wallet-card";
import { withProgress } from "@/lib/affiliate-home";
import { getBroughtIn } from "@/lib/data/brought-in";
import { getCommissionFor } from "@/lib/data/commission";
import { getCrewDay } from "@/lib/data/crew-day";
import { listPayoutRequests, myPaidOut } from "@/lib/data/payout-requests";
import { myReferrals } from "@/lib/data/referrals";
import { getCurrentProfile } from "@/lib/data/team";
import { myOpenEntry } from "@/lib/data/time-clock";
import { POSITIONS } from "@/lib/hiring/positions";
import { walletFor } from "@/lib/wallet";

const money = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

/**
 * The project technician's page, top to bottom:
 *
 * 1. Today: the Clock in button at the top of the same block as today's
 *    jobs, with the calendar and map a tap away underneath.
 * 2. Send your link to someone, with People you sent it to inside it.
 * 3. Wallet: their 4% from what their link brings in.
 * 4. Stages of Success: the technician track. Its stages are things the app
 *    can't see yet (training, reviews, meetings), so the account manager
 *    marks them; until that is built it shows the first as next.
 *
 * Drawn as getCurrentProfile(), so Preview as shows exactly this person.
 */
export async function TechHomePanel() {
  const profile = await getCurrentProfile();
  if (!profile) return <Box>Sign in again to see your day.</Box>;

  const [open, day, sent, projects, commission, requests, paidOut] = await Promise.all([
    myOpenEntry(profile.id).catch(() => null),
    getCrewDay().catch(() => null),
    myReferrals(profile.organization_id, profile.id),
    getBroughtIn(profile.id).catch(() => []),
    getCommissionFor(profile).catch(() => null),
    listPayoutRequests({ profileId: profile.id }).catch(() => []),
    myPaidOut(profile.id).catch(() => []),
  ]);
  const stops = day?.stops ?? [];
  const people = withProgress(sent, projects);
  const wallet = walletFor(commission, requests, paidOut);
  const track = POSITIONS.find((p) => p.key === "project-technician")?.growth;

  return (
    <div className="mx-auto grid w-full max-w-md gap-4">
      <section data-tour="crew-clock" aria-labelledby="tech-today" className="rounded-2xl border bg-card p-4 text-sm">
        <ClockControl open={open} stops={stops.map((s) => ({ jobId: s.jobId, sessionId: s.sessionId, name: s.customerName }))} />
        <h2 id="tech-today" className="mb-1 mt-4 text-xs font-bold uppercase tracking-wide text-muted-foreground">
          Today
        </h2>
        {day == null ? (
          <p className="text-muted-foreground">Today&apos;s jobs couldn&apos;t load just now. Reload the page.</p>
        ) : stops.length === 0 ? (
          <p className="text-muted-foreground">No jobs on your day.</p>
        ) : (
          <ul className="divide-y">
            {stops.map((s) => (
              <li key={s.sessionId} className="flex items-center justify-between gap-3 py-2">
                <Link href={`/jobs/${s.jobId}`} className="min-w-0 font-medium hover:underline">
                  {s.customerName}
                  {s.purpose ? <span className="font-normal text-muted-foreground"> · {s.purpose}</span> : null}
                </Link>
                <span className="min-w-0 max-w-[45%] truncate text-xs text-muted-foreground">{s.address}</span>
              </li>
            ))}
          </ul>
        )}
        <details data-tour="my-calendar" className="group mt-2 border-t pt-3">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-2 [&::-webkit-details-marker]:hidden">
            <span className="font-semibold">Calendar and map</span>
            <ChevronDown className="h-4 w-4 text-primary transition-transform group-open:rotate-180" aria-hidden />
          </summary>
          <div className="mt-3">
            <Suspense fallback={<p className="text-muted-foreground">Loading your calendar…</p>}>
              <MyCalendarPanel mode="crew" withClock={false} />
            </Suspense>
          </div>
        </details>
      </section>

      <SendLinkBlock people={people} />

      <Drop tour="affiliate-money" title="Wallet" hint={commission ? `${money(wallet.ready)} ready` : undefined}>
        {commission ? <WalletCard wallet={wallet} /> : <Box>Your wallet couldn&apos;t load just now. Reload the page.</Box>}
      </Drop>

      {track && <StageCard stage={{ done: 0, total: track.stages.length, next: track.stages[0], nextNeedsAManager: true }} />}
    </div>
  );
}

function Box({ children }: { children: React.ReactNode }) {
  return <div className="rounded-2xl border bg-card p-4 text-sm">{children}</div>;
}
