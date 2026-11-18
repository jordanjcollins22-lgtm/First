import { SendLink, WalletBlock, loadLinkAndWallet } from "@/components/phone/blocks";
import { Big, Card, Row, Screen, Sm, Stage, Sub, money } from "@/components/phone/parts";
import { firstName } from "@/components/phone/screens/affiliate-tech";
import { RangePicker } from "@/components/phone/range-picker";
import { loadApprovalQueue } from "@/lib/data/approval-queue";
import { loadFinanceDashboard } from "@/lib/data/finance";
import { listPayoutRequests } from "@/lib/data/payout-requests";
import { loadZipRevenue, pickRange, type Billed } from "@/lib/data/zip-revenue";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Profile } from "@/types/domain";

/**
 * Location partner. Nobody holds the role yet and the app has no partner
 * location, so each card says what it will hold rather than showing numbers
 * that aren't theirs. The link, wallet and stage work as for everyone.
 */
export async function PartnerPhone({ profile }: { profile: Profile }) {
  const lw = await loadLinkAndWallet(profile);
  return (
    <Screen hello={`Hi ${firstName(profile)}`} role="Location partner">
      <Card title="This week · your location">
        <Row a="Revenue" b="—" />
        <Row a="Booked out" b="—" />
        <Row a="New reviews" b="—" />
        <Row a="Callbacks" b="—" />
        <Sm>Fills in once a partner location is set up in the app.</Sm>
      </Card>
      <Card title="You keep this year">
        <Big>$0</Big>
        <Sm>owner profit · profit sharing · link</Sm>
      </Card>
      <Card title="Needs you">
        <Row a="Nothing waiting" />
      </Card>
      <SendLink people={lw.people} />
      <WalletBlock wallet={lw.wallet} />
      <Stage done={0} next="Enter profit mode and raise prices · Jordan approves" />
    </Screen>
  );
}

/** One location or ZIP code: its revenue on the line, and tap to see jobs and average ticket. */
function Place({ title, b, clients }: { title: string; b: Billed; clients?: number }) {
  return (
    <Sub title={title} sum={money(b.amount)}>
      <Row a="Revenue" b={money(b.amount)} />
      <Row a="Total jobs" b={String(b.jobs)} />
      <Row a="Average ticket" b={b.payers ? money(b.avgTicket) : "—"} />
      {clients != null && <Row a="Clients here" b={String(clients)} />}
    </Sub>
  );
}

const ROLES: [string, string][] = [
  ["affiliate", "Affiliate"],
  ["technician", "Technician"],
  ["account-manager", "Account manager"],
  ["partner", "Location partner"],
];

/**
 * The owner: every location (the home location's ZIP codes ranked by what
 * they billed in the chosen days), the company fee, what's waiting on them,
 * and every role's screen a tap away.
 */
export async function OwnerPhone({ profile, q = {} }: { profile: Profile; q?: { range?: string; from?: string; to?: string } }) {
  const now = new Date();
  const range = pickRange(q, now);
  const admin = createAdminClient();
  const [finance, zips, queue, payouts, lw] = await Promise.all([
    loadFinanceDashboard(profile.organization_id, now).catch(() => null),
    loadZipRevenue(profile.organization_id, range).catch(() => null),
    loadApprovalQueue(admin, profile.organization_id, now).catch(() => []),
    listPayoutRequests().catch(() => []),
    loadLinkAndWallet(profile),
  ]);
  const asked = payouts.filter((p) => p.status === "requested");
  const ytd = finance?.revenue.ytd.invoiced ?? 0;

  return (
    <Screen hello={firstName(profile)} role="Owner (only you)">
      <Card title="All locations">
        <RangePicker range={range} />
        {zips ? (
          <>
            <Place title="Forest Hill (home)" b={zips} />
            <Sub title="By ZIP code, most billed first" sum={zips.rows.length} open>
              {zips.rows.map((z) => (
                <Place key={z.zip} title={`${z.zip} · ${z.town}`} b={z} clients={z.clients} />
              ))}
              {zips.elsewhere.amount > 0 && <Place title="Outside Harford County or no address" b={zips.elsewhere} />}
              {zips.unmatched > 0 && <Row a="Checks and Zelle, no client yet" b={money(zips.unmatched)} />}
            </Sub>
          </>
        ) : (
          <Row a="Forest Hill (home)" b="Couldn't load" />
        )}
      </Card>
      <Card title="Company fee earned">
        <Big>$0</Big>
        <Sm>this year, 8% of every dollar a partner location bills. No partner locations yet.</Sm>
      </Card>
      <Card title="Waiting on you">
        {asked.map((p) => (
          <Row key={p.id} a={`${p.person} · payout`} b={money(p.amount)} tag="new" href="/admin/payments" />
        ))}
        {queue.slice(0, 6).map((q) => (
          <Row key={`${q.type}-${q.id}`} a={q.title} tag="new" />
        ))}
        {queue.length > 6 && <Row a={`${queue.length - 6} more`} />}
        {!asked.length && !queue.length && <Row a="Nothing waiting" />}
      </Card>
      <Card title="See what they see">
        {ROLES.map(([k, label]) => (
          <Row key={k} a={label} b="Open" href={`/me?role=${k}`} />
        ))}
      </Card>
      <SendLink people={lw.people} />
      <WalletBlock wallet={lw.wallet} />
      <Stage done={0} next="Grow the home location past $500,000 a year" note={finance ? `${money(ytd)} billed so far this year` : undefined} />
    </Screen>
  );
}
