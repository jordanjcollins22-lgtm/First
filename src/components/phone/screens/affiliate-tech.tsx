import { ClockControl } from "@/components/crew/clock-control";
import { SendLink, WalletBlock, loadLinkAndWallet } from "@/components/phone/blocks";
import { Card, Row, Screen, Stage } from "@/components/phone/parts";
import { affiliateStage } from "@/lib/affiliate-home";
import { outboundBaseUrl } from "@/lib/base-url";
import { myBookingLink } from "@/lib/data/brought-in";
import { getCrewDay } from "@/lib/data/crew-day";
import { myOpenEntry } from "@/lib/data/time-clock";
import { POSITIONS } from "@/lib/hiring/positions";
import type { Profile } from "@/types/domain";

export const firstName = (p: Profile) => p.first_name || (p.full_name ?? "").split(/\s+/)[0] || "there";

/** Affiliate, as the Hub draws it: Send your link (people inside), Wallet, Stages of Success. */
export async function AffiliatePhone({ profile }: { profile: Profile }) {
  const baseUrl = await outboundBaseUrl().catch(() => "");
  const [{ people, projects, commission, wallet }, link] = await Promise.all([
    loadLinkAndWallet(profile),
    myBookingLink(profile, baseUrl).catch(() => null),
  ]);
  const track = POSITIONS.find((p) => p.key === "affiliate")?.growth;
  const stage = track ? affiliateStage({ stages: track.stages, hasLink: !!link, projects, paid: commission?.paid ?? 0 }) : null;
  return (
    <Screen hello={`Hi ${firstName(profile)}`} role="Affiliate">
      <SendLink people={people} />
      <WalletBlock wallet={wallet} />
      {stage && <Stage done={stage.done} total={stage.total} next={stage.next} />}
    </Screen>
  );
}

/** Project technician: Today (Clock in on top of today's jobs), Send your link, Wallet, Stages of Success. */
export async function TechnicianPhone({ profile }: { profile: Profile }) {
  const [open, day, lw] = await Promise.all([
    myOpenEntry(profile.id).catch(() => null),
    getCrewDay().catch(() => null),
    loadLinkAndWallet(profile),
  ]);
  const stops = day?.stops ?? [];
  const track = POSITIONS.find((p) => p.key === "project-technician")?.growth;
  return (
    <Screen hello={`Morning, ${firstName(profile)}`} role="Project technician">
      <Card title="Today" tour="crew-clock">
        <div className="vx-clock">
          <ClockControl open={open} stops={stops.map((s) => ({ jobId: s.jobId, sessionId: s.sessionId, name: s.customerName }))} />
        </div>
        {day == null ? (
          <Row a="Today's jobs couldn't load just now. Reload the page." />
        ) : stops.length === 0 ? (
          <Row a="No jobs on your day." />
        ) : (
          stops.map((s) => <Row key={s.sessionId} a={`${s.customerName}${s.purpose ? ` · ${s.purpose}` : ""}`} b="Job sheet" href={`/jobs/${s.jobId}`} />)
        )}
      </Card>
      <SendLink people={lw.people} />
      <WalletBlock wallet={lw.wallet} />
      {track && <Stage done={0} total={track.stages.length + 1} next={track.stages[0]} />}
    </Screen>
  );
}
