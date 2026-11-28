import { ClockControl } from "@/components/crew/clock-control";
import { SendLink, WalletBlock, loadLinkAndWallet } from "@/components/phone/blocks";
import { Card, Row, Screen, Stage } from "@/components/phone/parts";
import { affiliateStage } from "@/lib/affiliate-home";
import { crewPath } from "@/lib/crew-link";
import { hazardLines, milesBetween } from "@/lib/crew-route";
import type { Stop } from "@/lib/crew-day";
import type { CrewToday } from "@/lib/data/crew-day";
import { outboundBaseUrl } from "@/lib/base-url";
import { myBookingLink } from "@/lib/data/brought-in";
import { getAllCrewsToday, getCrewDay } from "@/lib/data/crew-day";
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

/**
 * One job on the technician's day: where it falls in the order (start here,
 * then the closest one left), what's left to do there, any hazard, and a tap
 * through to its crew map.
 */
function DayStop({ stop, step, prev, done }: { stop: Stop; step: number; prev: Stop | null; done: boolean }) {
  const miles =
    prev && prev.lat != null && prev.lng != null && stop.lat != null && stop.lng != null
      ? milesBetween({ lat: prev.lat, lng: prev.lng }, { lat: stop.lat, lng: stop.lng })
      : null;
  const when = step === 1 ? "Start here" : miles != null ? `Next · ${miles < 0.1 ? "next door" : `${miles.toFixed(1)} mi from ${prev!.customerName}`}` : "Next";
  const hazards = hazardLines(stop.purpose);
  return (
    <Row
      href={crewPath(stop.jobId)}
      b="Crew map"
      tag={done ? "ok" : undefined}
      a={
        <span className="vx-stop">
          <i className="vx-tag">
            {step}. {when}
          </i>
          <strong>{stop.customerName}</strong>
          <small>{stop.address.replace(/, (Maryland|MD) \d{5}.*$/, "")}</small>
          {stop.purpose && <small>Left to do: {stop.purpose}</small>}
          {hazards.map((h) => (
            <small key={h} className="vx-hazard">
              Watch out: {h}
            </small>
          ))}
        </span>
      }
    />
  );
}

/** Every job on today, crew by crew, each in the order that crew works it. */
export function AllJobsToday({ crews, me }: { crews: CrewToday[] | null; me?: string }) {
  const total = (crews ?? []).reduce((n, c) => n + c.stops.length, 0);
  return (
    <Card title="All jobs today" right={crews ? `${total} job${total === 1 ? "" : "s"}` : undefined}>
      {crews == null ? (
        <Row a="Today's jobs couldn't load just now. Reload the page." />
      ) : crews.length === 0 ? (
        <Row a="No jobs on today." />
      ) : (
        crews.map((c) => (
          <div key={c.leadId ?? "none"} className="vx-crewday">
            <div className="vx-sm">
              <b>{c.leadId && c.leadId === me ? "Your crew" : `${c.leadName}'s crew`}</b>
            </div>
            {c.stops.map((s, i) => (
              <DayStop key={s.sessionId} stop={s} step={i + 1} prev={c.stops[i - 1] ?? null} done={false} />
            ))}
          </div>
        ))
      )}
    </Card>
  );
}

/** Project technician: Today (Clock in on top of today's jobs), Send your link, Wallet, Stages of Success. */
export async function TechnicianPhone({ profile }: { profile: Profile }) {
  const [open, day, lw, everyone] = await Promise.all([
    myOpenEntry(profile.id).catch(() => null),
    getCrewDay().catch(() => null),
    loadLinkAndWallet(profile),
    getAllCrewsToday().catch(() => null),
  ]);
  const stops = day?.stops ?? [];
  const finished = new Set((day?.events ?? []).filter((e) => e.kind === "finished_job" && e.jobId).map((e) => e.jobId!));
  const track = POSITIONS.find((p) => p.key === "project-technician")?.growth;
  return (
    <Screen hello={`Morning, ${firstName(profile)}`} role="Project technician">
      <Card title="Today" right="Your day" tour="crew-clock">
        <div className="vx-clock">
          <ClockControl open={open} stops={stops.map((s) => ({ jobId: s.jobId, sessionId: s.sessionId, name: s.customerName }))} />
        </div>
        {day == null ? (
          <Row a="Today's jobs couldn't load just now. Reload the page." />
        ) : stops.length === 0 ? (
          <Row a="No jobs on your day." />
        ) : (
          stops.map((s, i) => (
            <DayStop key={s.sessionId} stop={s} step={i + 1} prev={stops[i - 1] ?? null} done={finished.has(s.jobId)} />
          ))
        )}
      </Card>
      <AllJobsToday crews={everyone} me={profile.id} />
      <SendLink people={lw.people} />
      <WalletBlock wallet={lw.wallet} />
      {track && <Stage done={0} total={track.stages.length + 1} next={track.stages[0]} />}
    </Screen>
  );
}
