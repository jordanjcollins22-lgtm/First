import { ReferralMessageCard } from "@/components/v2/panels/role/referral-message-card";
import { Card, Drop, Row, Sub, money } from "@/components/phone/parts";
import { PayoutButton } from "@/components/phone/live";
import { withProgress } from "@/lib/affiliate-home";
import type { BroughtInRow } from "@/lib/brought-in";
import { getBroughtIn } from "@/lib/data/brought-in";
import { getCommissionFor } from "@/lib/data/commission";
import { listPayoutRequests, myPaidOut } from "@/lib/data/payout-requests";
import { myReferrals, type ReferralRow } from "@/lib/data/referrals";
import { affiliationLabel } from "@/lib/referral-message";
import { walletFor, type Wallet } from "@/lib/wallet";
import type { Profile } from "@/types/domain";

const day = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" });

/** What every position with a link reads: who they sent it to, what it brought in, and their wallet. */
export async function loadLinkAndWallet(profile: Profile) {
  const [sent, projects, commission, requests, paidOut] = await Promise.all([
    myReferrals(profile.organization_id, profile.id).catch(() => [] as ReferralRow[]),
    getBroughtIn(profile.id).catch(() => [] as BroughtInRow[]),
    getCommissionFor(profile).catch(() => null),
    listPayoutRequests({ profileId: profile.id }).catch(() => []),
    myPaidOut(profile.id).catch(() => []),
  ]);
  return {
    people: withProgress(sent, projects),
    projects,
    commission,
    wallet: commission ? walletFor(commission, requests, paidOut) : null,
  };
}

const STEP = { sent: "Sent", opened: "Opened", booked: "Booked", sold: "Sold", lost: "Didn't go ahead" } as const;

/** Send your link to someone, with People you sent it to inside it. One block. */
export function SendLink({ people }: { people: ReferralRow[] }) {
  return (
    <div className="vx-card" data-tour="affiliate-link">
      <div className="vx-ct">Send your link to someone</div>
      <div className="vx-send">
        <ReferralMessageCard />
      </div>
      <Sub title="People you sent it to" sum={people.length}>
        {people.length ? (
          people.map((p, i) => {
            const step = p.progress ?? (p.clicks > 0 ? "opened" : "sent");
            return (
              <Row
                key={p.code ?? i}
                a={`${p.name} · ${affiliationLabel(p.affiliation)}`}
                b={`${STEP[step]}${step === "sold" && p.yours != null ? ` · ${money(p.yours)}` : ""}`}
              />
            );
          })
        ) : (
          <Row a="Nobody yet" />
        )}
      </Sub>
    </div>
  );
}

/** Wallet: ready, pending, Request payout, then the last two in and out. Closed until tapped. */
export function WalletBlock({ wallet }: { wallet: Wallet | null }) {
  if (!wallet) {
    return (
      <Drop title="Wallet" sum="" tour="affiliate-money">
        <Row a="Your wallet couldn't load just now. Reload the page." />
      </Drop>
    );
  }
  return (
    <Drop title="Wallet" sum={`${money(wallet.ready)} ready`} tour="affiliate-money">
      <Row a="Ready to pay out" b={money(wallet.ready)} />
      <Row a="Waiting on client to pay" b={money(wallet.waiting)} />
      {wallet.onHold > 0 && <Row a="On hold until a job is put right" b={money(wallet.onHold)} />}
      <PayoutButton wallet={{ open: wallet.open, canRequest: wallet.canRequest }} />
      {wallet.history.slice(0, 2).map((h, i) => (
        <Row key={i} a={`${h.at ? `${day(h.at)} · ` : ""}${h.label}`} b={`${h.amount >= 0 ? "+" : ""}${money(h.amount)}`} />
      ))}
    </Drop>
  );
}

export function Empty({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card title={title}>
      <div className="vx-sm">{children}</div>
    </Card>
  );
}
