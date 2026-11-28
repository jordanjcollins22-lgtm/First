import Link from "next/link";
import { redirect } from "next/navigation";

import { AppointmentLine, CrewCalendar } from "@/components/phone/crew-calendar";
import { OnlyApp } from "@/components/phone/only-app";
import { Card, Row, Screen } from "@/components/phone/parts";
import { type CrewOption } from "@/components/phone/schedule-job";
import { AllJobsToday, firstName } from "@/components/phone/screens/affiliate-tech";
import { getAllCrewsToday } from "@/lib/data/crew-day";
import { listApplicants, type ApplicantRow } from "@/lib/data/hiring";
import { listBoardJobs } from "@/lib/data/job-board";
import { interviewsBetween, loadPastCrewDays, loadSiteVisits, type Appointment, type PastDay } from "@/lib/data/schedule";
import { getCurrentProfile, listProfiles } from "@/lib/data/team";
import type { BoardJob } from "@/lib/job-board";
import { meScreenFor } from "@/lib/me-screen";
import { dateKeyIn } from "@/lib/time-zone";
import { nextWorkDay } from "@/lib/work-days";
import type { Profile } from "@/types/domain";

export const dynamic = "force-dynamic";

const DAY = 86_400_000;
const TABS = [
  { key: "today", label: "Today" },
  { key: "calendar", label: "Calendar" },
  { key: "history", label: "History" },
] as const;
type Tab = (typeof TABS)[number]["key"];

const addDays = (key: string, n: number) => new Date(new Date(`${key}T12:00:00Z`).getTime() + n * DAY).toISOString().slice(0, 10);
const longDay = (key: string) =>
  new Date(`${key}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric", timeZone: "UTC" });
const shortDay = (key: string) => new Date(`${key}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

/** This week's Monday through five weeks of work days (Mon to Sat): about a month ahead. */
function monthAhead(today: string) {
  const t = new Date(`${today}T12:00:00Z`);
  const monday = addDays(today, -((t.getUTCDay() + 6) % 7));
  const days: string[] = [];
  for (let i = 0; i < 35; i++) {
    const d = addDays(monday, i);
    if (new Date(`${d}T12:00:00Z`).getUTCDay() !== 0) days.push(d);
  }
  return { days, from: days[0], to: days[days.length - 1] };
}

/**
 * The one Schedule app (Jordan, Nov 28): Today, the next month on a calendar
 * with the wait list under it, and History. Crew work days, paid site visits
 * and interviews all in one place.
 */
export default async function SchedulePage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login?next=/schedule");
  const { tab: asked } = await searchParams;
  const tab: Tab = TABS.some((t) => t.key === asked) ? (asked as Tab) : "today";
  const screen = meScreenFor(profile);
  const everyone = screen === "owner";
  const today = dateKeyIn(new Date());

  return (
    <>
      <OnlyApp id="schedule" home="/me" />
      <Screen hello="Schedule" role={TABS.find((t) => t.key === tab)!.label}>
        {tab === "today" ? (
          <TodayTab profile={profile} today={today} everyone={everyone} />
        ) : tab === "calendar" ? (
          <CalendarTab profile={profile} today={today} everyone={everyone} />
        ) : (
          <HistoryTab today={today} />
        )}
        <nav className="vx-tabs" aria-label="Schedule">
          {TABS.map((t) => (
            <Link key={t.key} href={`/schedule?tab=${t.key}`} className={t.key === tab ? "on" : ""} aria-current={t.key === tab ? "page" : undefined}>
              {t.label}
            </Link>
          ))}
        </nav>
      </Screen>
    </>
  );
}

async function appointmentsBetween(profile: Profile, from: string, to: string, everyone: boolean): Promise<Appointment[]> {
  const [visits, applicants] = await Promise.all([
    loadSiteVisits(profile, from, to, everyone).catch(() => [] as Appointment[]),
    listApplicants(profile.organization_id).catch(() => [] as ApplicantRow[]),
  ]);
  return [...visits, ...interviewsBetween(applicants, from, to)].sort((a, b) => a.at.localeCompare(b.at));
}

async function TodayTab({ profile, today, everyone }: { profile: Profile; today: string; everyone: boolean }) {
  const [crews, appts] = await Promise.all([getAllCrewsToday().catch(() => null), appointmentsBetween(profile, today, today, everyone)]);
  return (
    <>
      <Card title={longDay(today)} right="Visits and interviews">
        {appts.length ? appts.map((a) => <AppointmentLine key={`${a.kind}-${a.id}`} a={a} />) : <Row a="No site visits or interviews today." />}
      </Card>
      <AllJobsToday crews={crews} me={profile.id} />
    </>
  );
}

async function CalendarTab({ profile, today, everyone }: { profile: Profile; today: string; everyone: boolean }) {
  const span = monthAhead(today);
  const [board, team, appts] = await Promise.all([
    listBoardJobs().catch(() => [] as BoardJob[]),
    listProfiles().catch(() => [] as Profile[]),
    appointmentsBetween(profile, span.from, span.to, everyone),
  ]);
  const open = (j: BoardJob) => !j.declined && (j.status === "approved" || j.status === "in_progress");
  const start = (j: BoardJob) => j.workStartsOn!.slice(0, 10);
  const booked = board
    .filter((j) => !j.declined && j.workStartsOn && start(j) >= span.from && start(j) <= span.to && (open(j) || j.status === "completed"))
    .sort((a, b) => start(a).localeCompare(start(b)));
  // Sold and not finished, with no date, or a date that went by: still waiting.
  const waitList = board.filter((j) => open(j) && (!j.workStartsOn || start(j) < span.from)).sort((a, b) => (a.startsOn ?? "").localeCompare(b.startsOn ?? ""));
  const later = board.filter((j) => open(j) && j.workStartsOn && start(j) > span.to).sort((a, b) => start(a).localeCompare(start(b)));
  const crews: CrewOption[] = team
    .filter((p) => ["technician", "owner"].includes(meScreenFor(p) ?? ""))
    .map((p) => ({ id: p.id, name: firstName(p) }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return (
    <Card title="Next month" right={`${shortDay(span.from)} to ${shortDay(span.to)}`}>
      <div className="vx-sm">
        {booked.length} crew job{booked.length === 1 ? "" : "s"}, {appts.length} visit{appts.length === 1 ? "" : "s"} and interview{appts.length === 1 ? "" : "s"},{" "}
        {waitList.length} on the wait list. Tap a day to jump to it.
      </div>
      <CrewCalendar
        days={span.days}
        today={today}
        booked={booked}
        waitList={waitList}
        later={later}
        crews={crews}
        firstOpenDay={nextWorkDay(today)}
        appointments={appts}
      />
    </Card>
  );
}

async function HistoryTab({ today }: { today: string }) {
  const from = addDays(today, -60);
  const past = await loadPastCrewDays(from, today).catch(() => [] as PastDay[]);
  const byDay = new Map<string, PastDay[]>();
  for (const p of past) byDay.set(p.day, [...(byDay.get(p.day) ?? []), p]);
  return (
    <Card title="Past 60 days" right={`${past.length} crew day${past.length === 1 ? "" : "s"}`}>
      {past.length === 0 ? (
        <Row a="No crew days in the last 60 days." />
      ) : (
        <div className="vx-cal">
          {[...byDay.entries()].map(([day, rows]) => (
            <section key={day} className="vx-cal-agenda">
              <h4>{longDay(day)}</h4>
              {rows.map((r) => (
                <div key={r.sessionId} className="vx-cal-job">
                  <Link href={`/jobs/${r.jobId}`} className="vx-cal-job-link">
                    <span className="vx-cal-who">{r.customerName}</span>
                    <span className="vx-cal-what">{r.work}</span>
                    <span className="vx-cal-note">{r.done ? "Done" : "Not marked done"}</span>
                  </Link>
                </div>
              ))}
            </section>
          ))}
        </div>
      )}
    </Card>
  );
}
