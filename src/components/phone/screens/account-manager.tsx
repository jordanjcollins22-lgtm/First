import Link from "next/link";

import { Empty, SendLink, WalletBlock, loadLinkAndWallet } from "@/components/phone/blocks";
import { ClientSearch, OneAtATime, type OneItem } from "@/components/phone/live";
import { Big, Btn, Card, Row, Screen, Sm, Stage, Sub, money } from "@/components/phone/parts";
import { firstName } from "@/components/phone/screens/affiliate-tech";
import { outstandingFor } from "@/lib/am-home";
import { sentAgo, workOf } from "@/lib/proposal-outcome";
import { loadAmAccounts, loadAmFollowUps, loadAmSales, type FollowUp } from "@/lib/data/am-home";
import { loadFinanceDashboard } from "@/lib/data/finance";
import { listApplicants, type ApplicantRow } from "@/lib/data/hiring";
import { listBoardJobs } from "@/lib/data/job-board";
import { POSITIONS, positionFor } from "@/lib/hiring/positions";
import { stageLabel } from "@/lib/hiring/screening";
import type { BoardJob } from "@/lib/job-board";
import { createClient } from "@/lib/supabase/server";
import { dateKeyIn } from "@/lib/time-zone";
import type { Profile } from "@/types/domain";

const TZ = "America/New_York";
/** Only search, Do now and Hiring on the account manager page for now (Jordan, Nov 19 and 21). */
const TASKS_ONLY = true;
const DAY = 86_400_000;
const dayLabel = (key: string) => new Date(`${key}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", day: "numeric", timeZone: "UTC" });
const shortDay = (key: string) => new Date(`${key}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const timeOf = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: TZ }).replace(":00", "").replace(" AM", " am").replace(" PM", " pm");
const shortTime = (iso: string) => timeOf(iso).replace(" am", "a").replace(" pm", "p");
const last = (name: string) => name.trim().split(/\s+/).slice(-1)[0] || name;

/** Monday of this week, and the twelve working days (Mon to Sat) of this week and next. */
function twoWeeks(now: Date) {
  const today = dateKeyIn(now);
  const t = new Date(`${today}T12:00:00Z`);
  const monday = new Date(t.getTime() - ((t.getUTCDay() + 6) % 7) * DAY);
  const days: string[] = [];
  for (let i = 0; i < 14; i++) {
    const d = new Date(monday.getTime() + i * DAY);
    if (d.getUTCDay() !== 0) days.push(d.toISOString().slice(0, 10));
  }
  return { today, days, from: days[0], to: days[days.length - 1] };
}

interface Visit {
  jobId: string;
  at: string;
  day: string;
  name: string;
  kind: "visit" | "interview";
  what: string;
}

/** Visits booked in the next two weeks, the account manager's own clients (or everyone's when nobody is set). */
async function visitsBetween(profile: Profile, from: string, to: string): Promise<Visit[]> {
  const sb = await createClient();
  const { data } = await sb
    .from("jobs")
    .select("id,name,evaluation_date,evaluation_status,cancelled_at,property:properties!inner(customer:customers!inner(name,account_manager_id,organization_id))")
    .eq("property.customer.organization_id", profile.organization_id)
    .gte("evaluation_date", `${from}T00:00:00`)
    .lte("evaluation_date", `${to}T23:59:59`)
    .is("cancelled_at", null)
    .order("evaluation_date", { ascending: true })
    .limit(200);
  type R = { id: string; name: string | null; evaluation_date: string; evaluation_status: string | null; property: { customer: { name: string | null; account_manager_id: string | null } } | null };
  return ((data ?? []) as unknown as R[])
    .filter((j) => j.evaluation_status !== "cancelled" && j.evaluation_status !== "no_show")
    .filter((j) => {
      const am = j.property?.customer?.account_manager_id;
      return !am || am === profile.id;
    })
    .map((j) => ({
      jobId: j.id,
      at: j.evaluation_date,
      day: dateKeyIn(new Date(j.evaluation_date)),
      name: j.property?.customer?.name || "Client",
      kind: "visit" as const,
      what: j.name || "visit",
    }));
}

function interviewsOf(applicants: ApplicantRow[], from: string, to: string): Visit[] {
  return applicants
    .filter((a) => a.interviewAt && (a.stage === "interview" || a.stage === "working_interview"))
    .map((a) => ({ jobId: a.id, at: a.interviewAt!, day: dateKeyIn(new Date(a.interviewAt!)), name: a.name, kind: "interview" as const, what: a.position.replace("-", " ") }))
    .filter((v) => v.day >= from && v.day <= to);
}

const IN_INTERVIEWS = new Set(["interview", "working_interview", "owner_talk", "offer_sent"]);

/** One applicant: tap the name to open them (record the call, book the interview, say what happened), or Call. */
function ApplicantLine({ a, b }: { a: ApplicantRow; b: string }) {
  const p = positionFor(a.position);
  const tel = a.phone.replace(/[^\d+]/g, "");
  return (
    <div className="vx-row">
      <Link href={`/admin/hiring/${a.id}`} className="vx-tap" style={{ flex: 1, minWidth: 0 }}>
        <span>
          {a.name} · {p ? (p.closed ? `${p.title} (role closed)` : p.title) : a.position}
        </span>
        <br />
        <small className="vx-sm">{b}</small>
      </Link>
      {tel && (
        <a href={`tel:${tel}`} className="vx-call">
          Call
        </a>
      )}
    </div>
  );
}

const STATUS: Record<string, string> = { completed: "Completed", in_progress: "In progress", approved: "Not started" };

/**
 * The account manager's home, top to bottom: search, Do now one at a time,
 * Hiring, then (hidden for now) Your schedule, Crew schedule, Business, the
 * link, wallet and stage. Every client name opens that client.
 */
export async function AccountManagerPhone({ profile }: { profile: Profile }) {
  const now = new Date();
  const weeks = twoWeeks(now);
  const [accounts, sales, applicants, board, visits, finance, lw, followUps] = await Promise.all([
    loadAmAccounts(profile, now).catch(() => null),
    loadAmSales(profile, now).catch(() => null),
    listApplicants(profile.organization_id).catch(() => [] as ApplicantRow[]),
    listBoardJobs().catch(() => [] as BoardJob[]),
    visitsBetween(profile, weeks.from, weeks.to).catch(() => [] as Visit[]),
    loadFinanceDashboard(profile.organization_id, now).catch(() => null),
    loadLinkAndWallet(profile),
    loadAmFollowUps(profile).catch(() => [] as FollowUp[]),
  ]);

  /* Do now ------------------------------------------------------------ */
  const items: OneItem[] = [];
  // Sales follow-ups come first: who to get back to and why.
  for (const f of followUps) {
    items.push({ tag: "Follow up", who: f.title, body: f.note ? <div className="vx-q" style={{ whiteSpace: "pre-line" }}>{f.note}</div> : undefined, main: { label: "Done" }, followUp: f.id });
  }
  // Then every proposal the client has not answered: Yes or No, and why.
  for (const p of sales?.open ?? []) {
    const expired = p.expiresAt != null && new Date(p.expiresAt).getTime() < now.getTime();
    items.push({
      tag: "Close this proposal",
      who: p.customerName,
      whoHref: `/jobs/${p.jobId}`,
      body: (
        <>
          <Row a={workOf(p.jobName)} b={money(p.total)} />
          <Row a={sentAgo(p.sentAt, now)} b={expired ? "Expired" : ""} />
        </>
      ),
      main: { label: "Open proposal", href: `/jobs/${p.jobId}` },
      closeProposal: p.proposalId,
    });
  }
  for (const p of sales?.toApprove ?? []) {
    items.push({ tag: "Proposal to send", who: p.customerName, whoHref: `/jobs/${p.jobId}`, body: <Row a="Total" b={money(p.total)} />, main: { label: "Open proposal", href: `/jobs/${p.jobId}` } });
  }
  // Do now is proposals and sales follow-ups only (Jordan, Nov 19). Replies,
  // callbacks, unpaid invoices and leads to book stay out of it for now.

  /* Your schedule ----------------------------------------------------- */
  const all = [...visits, ...interviewsOf(applicants, weeks.from, weeks.to)].sort((a, b) => a.at.localeCompare(b.at));
  const today = all.filter((v) => v.day === weeks.today);
  const nextVisit = today.find((v) => v.kind === "visit" && new Date(v.at).getTime() > now.getTime() - 60 * 60_000);

  /* Crew schedule ----------------------------------------------------- */
  const inWindow = board.filter((j) => !j.declined && j.workStartsOn && j.workStartsOn.slice(0, 10) >= weeks.from && j.workStartsOn.slice(0, 10) <= weeks.to && STATUS[j.status]);
  const crews = new Map<string, BoardJob[]>();
  for (const j of inWindow.sort((a, b) => (a.workStartsOn ?? "").localeCompare(b.workStartsOn ?? ""))) {
    const k = j.assignedToName || "Nobody assigned";
    crews.set(k, [...(crews.get(k) ?? []), j]);
  }
  const waitList = board.filter((j) => !j.declined && j.status === "approved" && !j.workStartsOn).sort((a, b) => (a.startsOn ?? "").localeCompare(b.startsOn ?? ""));

  /* Hiring ------------------------------------------------------------ */
  // Everyone who applied and is waiting on a call: video in first, then the
  // ones still owing a video. Newest first in each.
  const toCall = [...applicants.filter((a) => a.stage === "video_submitted"), ...applicants.filter((a) => a.stage === "video_requested")];
  const inInterviews = applicants
    .filter((a) => IN_INTERVIEWS.has(a.stage))
    .sort((a, b) => (a.interviewAt ?? "9").localeCompare(b.interviewAt ?? "9"));

  /* Business ---------------------------------------------------------- */
  const month = finance?.revenue.month;
  const unpaid = accounts?.invoices ?? [];
  const net = finance?.ratios.net.value;

  const track = POSITIONS.find((p) => p.key === "account-manager")?.growth;
  const clients = (accounts?.clients ?? []).map((c) => ({ id: c.id, name: c.name, href: `/clients/${c.id}` }));

  return (
    <Screen hello={`Hi ${firstName(profile)}`} role="Account manager">
      <ClientSearch clients={clients} />

      <OneAtATime title="Do now" items={items} />

      {/* Jordan, Nov 21: Jace calls applicants, books interviews and says how they went from here. */}
      <Card title="Hiring" right={toCall.length ? `${toCall.length} to call` : undefined}>
        <Sub
          open
          title={
            <>
              Applied, need a call
              {toCall.length > 0 && (
                <>
                  <br />
                  <em className="vx-act">Tap a name to record the call and book the interview</em>
                </>
              )}
            </>
          }
          sum={toCall.length}
        >
          {toCall.length ? toCall.map((a) => <ApplicantLine key={a.id} a={a} b={`${a.stage === "video_submitted" ? "Video in" : "No video yet"} · applied ${shortDay(dateKeyIn(new Date(a.createdAt)))}${a.source ? ` · ${a.source}` : ""}`} />) : <Row a="Nobody waiting on a call" />}
        </Sub>
        <Sub open={inInterviews.length > 0} title="Interviews" sum={inInterviews.length}>
          {inInterviews.length ? (
            inInterviews.map((a) => (
              <ApplicantLine
                key={a.id}
                a={a}
                b={`${stageLabel(a.stage, a.position)}${a.interviewAt ? ` · ${dayLabel(dateKeyIn(new Date(a.interviewAt)))} ${timeOf(a.interviewAt)}` : " · no time booked"}`}
              />
            ))
          ) : (
            <Row a="None booked" />
          )}
        </Sub>
      </Card>

      {/* Jordan, Nov 19: for now the page is only his tasks. The rest comes back when it is wanted. */}
      {!TASKS_ONLY && (
      <>
      <Card title="Your schedule">
        {today.length ? (
          today.map((v) => (
            <Row key={`${v.kind}-${v.jobId}`} a={`${timeOf(v.at)} · ${v.name} · ${v.what}`} b={v.kind === "visit" ? "Paid visit" : "Interview"} href={v.kind === "visit" ? `/jobs/${v.jobId}` : `/admin/hiring/${v.jobId}`} />
          ))
        ) : (
          <Row a="Nothing booked today" />
        )}
        {nextVisit && <Btn href={`/jobs/${nextVisit.jobId}`}>Start {timeOf(nextVisit.at)} visit</Btn>}
        <Sub title={`Next 2 weeks · ${shortDay(weeks.from)} to ${shortDay(weeks.to).replace(/^[A-Za-z]+ /, "")}`} sum={all.length}>
          <div className="vx-cal">
            {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((h) => (
              <span key={h} className="h">
                {h}
              </span>
            ))}
            {weeks.days.map((d) => (
              <div key={d} className={d === weeks.today ? "d t" : d < weeks.today ? "d p" : "d"}>
                <b>{Number(d.slice(8))}</b>
                {all
                  .filter((v) => v.day === d)
                  .map((v) => (
                    <i key={`${v.kind}-${v.jobId}`} className={v.kind === "interview" ? "ki" : "kv"}>
                      {shortTime(v.at)}
                      <br />
                      {last(v.name)}
                    </i>
                  ))}
              </div>
            ))}
          </div>
          <div className="vx-key">
            <span className="kv">Paid visit</span>
            <span className="ki">Interview</span>
          </div>
        </Sub>
      </Card>

      <Card title="Crew schedule · next 2 weeks" right={`${shortDay(weeks.from)} to ${shortDay(weeks.to).replace(/^[A-Za-z]+ /, "")}`}>
        <Big>{inWindow.length} booked</Big>
        <Sm>
          projects in the next 2 weeks, {waitList.length} on the wait list
        </Sm>
        {[...crews.entries()].map(([crew, jobs]) => (
          <Sub key={crew} title={crew} sum={`${jobs.length} job${jobs.length === 1 ? "" : "s"}`}>
            {jobs.map((j) => (
              <Row key={j.id} a={`${dayLabel(j.workStartsOn!.slice(0, 10))} · ${j.customerName ?? "Client"} · ${j.name}`} b={STATUS[j.status]} href={`/jobs/${j.id}`} />
            ))}
          </Sub>
        ))}
        <Sub title="Wait list" sum={waitList.length}>
          {waitList.length ? waitList.map((j, i) => <Row key={j.id} a={`${i + 1}. ${j.customerName ?? "Client"} · ${j.name}`} b="Not scheduled" href={`/jobs/${j.id}`} />) : <Row a="Nobody waiting" />}
        </Sub>
      </Card>

      {finance || unpaid.length ? (
        <Card title="Business">
          {finance && (
            <Sub title="Project review" sum={net != null ? `${Math.round(net)}% profit` : ""}>
              <Row a="Billed this month" b={money(month?.invoiced ?? 0)} />
              <Row a="Projects costed" b={finance.costedJobs} />
            </Sub>
          )}
          <Sub title="Money in and out" sum={month ? `+${money(month.collected)}` : ""}>
            {month && <Row a="In from clients this month" b={money(month.collected)} />}
            <Sub title="Unpaid invoices" sum={`${unpaid.length} · ${money(unpaid.reduce((s, i) => s + i.amount, 0))}`}>
              {unpaid.length ? unpaid.map((i) => <Row key={i.invoiceId} a={`${i.customerName} · ${outstandingFor(i, now)}`} b={money(i.amount)} href={`/jobs/${i.jobId}`} />) : <Row a="None" />}
            </Sub>
          </Sub>
        </Card>
      ) : (
        <Empty title="Business">Business numbers couldn&apos;t load just now.</Empty>
      )}

      <SendLink people={lw.people} />
      <WalletBlock wallet={lw.wallet} />
      {track && <Stage done={0} total={track.stages.length + 1} next={track.stages[0]} />}
      </>
      )}
    </Screen>
  );
}
