import { ChevronDown } from "lucide-react";

import { AffiliateLinkCard } from "@/components/v2/panels/role/affiliate-link-card";
import { SendLinkBlock } from "@/components/v2/panels/role/send-link-block";
import { myReferrals } from "@/lib/data/referrals";
import { affiliateStage, withProgress, type AffiliateStage } from "@/lib/affiliate-home";
import { POSITIONS } from "@/lib/hiring/positions";
import { WalletCard } from "@/components/v2/panels/role/wallet-card";
import { listPayoutRequests, myPaidOut } from "@/lib/data/payout-requests";
import { walletFor } from "@/lib/wallet";
import { outboundBaseUrl } from "@/lib/base-url";
import type { BroughtInRow } from "@/lib/brought-in";
import { getBroughtIn, myBookingLink } from "@/lib/data/brought-in";
import { getCommissionFor } from "@/lib/data/commission";
import { getCurrentProfile } from "@/lib/data/team";
import { qrSvg } from "@/lib/qr";
import { cn } from "@/lib/utils";

const money = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

/**
 * The affiliate's home screen in the new layout: their whole day on one
 * phone screen, top to bottom in the order they do it.
 *
 * 1. Send your link to someone: who it's for and how they know them, then a
 *    message ready to copy with its own tracked link. Someone they found
 *    online asking for yard work goes in here too ("Someone online", with a
 *    screenshot). Inside it, People you sent it to drops down: each one with
 *    how far they got (sent, opened, booked, sold) and their 4% once sold.
 *    Their plain link and QR code sit at the foot.
 * 2. Their wallet: ready to pay out, waiting on the client, and a payout request.
 * 3. Their stage on the Stages of Success, and what the next one asks.
 *
 * Drawn as getCurrentProfile(), so Preview as shows exactly this person.
 * Everything here is theirs alone: no company or other affiliate's numbers
 * are read.
 */
export async function AffiliateHomePanel() {
  const profile = await getCurrentProfile();
  if (!profile) return <Card>Sign in again to see your day.</Card>;
  const org = profile.organization_id;
  const baseUrl = await outboundBaseUrl().catch(() => "");

  const [projects, link, commission, sent, requests, paidOut] = await Promise.all([
    getBroughtIn(profile.id).catch(() => null),
    myBookingLink(profile, baseUrl).catch(() => null),
    getCommissionFor(profile).catch((err) => {
      console.error("Affiliate home: commission failed to load:", err);
      return null;
    }),
    myReferrals(org, profile.id),
    // Before the payout migration has run, the wallet simply has no requests yet.
    listPayoutRequests({ profileId: profile.id }).catch(() => []),
    myPaidOut(profile.id).catch(() => []),
  ]);
  const qr = link ? await qrSvg(link, 256).catch(() => null) : null;
  const people = withProgress(sent, projects ?? []);
  const wallet = walletFor(commission, requests, paidOut);
  const track = POSITIONS.find((p) => p.key === "affiliate")?.growth;
  const stage = track ? affiliateStage({ stages: track.stages, hasLink: !!link, projects: projects ?? [], paid: commission?.paid ?? 0 }) : null;

  return (
    <div className="mx-auto grid w-full max-w-md gap-4">
      <SendLinkBlock
        title="1. Send your link to someone"
        people={people}
        footer={
          <details className="mt-3 border-t pt-3">
            <summary className="cursor-pointer font-medium">Just your link, or a QR code</summary>
            <div className="mt-3">
              <AffiliateLinkCard link={link} qrSvg={qr} />
            </div>
          </details>
        }
      >
        {projects && projects.length > 0 && <OtherBookings projects={projects} people={people} />}
      </SendLinkBlock>

      <Drop tour="affiliate-money" title="Wallet" hint={commission ? `${money(wallet.ready)} ready` : undefined}>
        {commission ? <WalletCard wallet={wallet} /> : <Card>Your wallet couldn&apos;t load just now. Reload the page.</Card>}
      </Drop>

      {stage && <StageCard stage={stage} />}
    </div>
  );
}

/** Bookings that came another way (their plain link or QR code), so none go missing from the list. */
function OtherBookings({ projects, people }: { projects: BroughtInRow[]; people: { code?: string }[] }) {
  const codes = new Set(people.map((p) => p.code).filter(Boolean));
  const other = projects.filter((p) => !p.referralCode || !codes.has(p.referralCode));
  if (other.length === 0) return null;
  return (
    <div className="mt-3">
      <p className="mb-1 text-xs font-bold uppercase tracking-wide text-muted-foreground">Booked another way</p>
      <ul className="grid gap-2">
        {other.map((p) => (
          <ProjectRow key={p.jobId} row={p} />
        ))}
      </ul>
    </div>
  );
}

export function StageCard({ stage }: { stage: AffiliateStage }) {
  return (
    <section data-tour="affiliate-stage" className="rounded-2xl border bg-card p-4 text-sm">
      <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Stages of Success</p>
      <div className="my-2 flex gap-1" aria-hidden>
        {Array.from({ length: stage.total }, (_, i) => (
          <span key={i} className={cn("h-2 flex-1 rounded-full", i < stage.done ? "bg-primary" : i === stage.done ? "bg-primary/40" : "bg-muted")} />
        ))}
      </div>
      <p className="font-semibold">
        {stage.done} of {stage.total} stages done
      </p>
      {stage.next ? (
        <p className="text-muted-foreground">
          Next: {stage.next}.{stage.nextNeedsAManager ? " Your account manager marks this one when it happens." : ""}
        </p>
      ) : (
        <p className="text-muted-foreground">Track done. Stage 7 is optional: join the crew as a project technician when you&apos;re ready.</p>
      )}
    </section>
  );
}

/** A section that stays closed until it's tapped, so the top of the screen is the one thing to do. */
export function Drop({ title, hint, tour, open, children }: { title: string; hint?: string; tour?: string; open?: boolean; children: React.ReactNode }) {
  return (
    <details data-tour={tour} open={open} className="group rounded-2xl border bg-card text-sm">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 p-4 [&::-webkit-details-marker]:hidden">
        <span className="min-w-0">
          <span className="block font-bold">{title}</span>
          {hint ? <span className="block text-xs text-muted-foreground">{hint}</span> : null}
        </span>
        <ChevronDown className="h-5 w-5 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" aria-hidden />
      </summary>
      <div className="px-4 pb-4">{children}</div>
    </details>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return <div className="rounded-2xl border bg-card p-4 text-sm">{children}</div>;
}

function ProjectRow({ row }: { row: BroughtInRow }) {
  const won = row.step === "sold" || row.step === "done";
  return (
    <li className={cn("rounded-xl border bg-card p-3 text-sm", won && "border-emerald-400 bg-emerald-50/50 dark:bg-emerald-500/10", row.step === "lost" && "opacity-60")}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-semibold">{row.client}</span>
        {row.yours != null && <span className="shrink-0 text-xs font-semibold tabular-nums text-emerald-700 dark:text-emerald-300">Your 4%: {money(row.yours)}</span>}
      </div>
      <p className="mt-0.5 text-xs text-muted-foreground">{row.label}</p>
    </li>
  );
}
