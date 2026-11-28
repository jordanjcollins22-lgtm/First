import Link from "next/link";

import { Empty, SendLink, WalletBlock, loadLinkAndWallet } from "@/components/phone/blocks";
import { ClientSearch, OneAtATime, type OneItem } from "@/components/phone/live";
import { NewEstimate } from "@/components/phone/new-estimate";
import { EstimateButton } from "@/components/phone/estimate-button";
import { ProposalButtons } from "@/components/phone/proposal-buttons";
import { BookVisit, FinishVisit, VisitSteps } from "@/components/phone/visit-buttons";
import { loadAmEvaluations, type EvalVisit } from "@/lib/data/am-evaluations";
import { type CrewOption } from "@/components/phone/schedule-job";
import { CrewCalendar } from "@/components/phone/crew-calendar";
import { Big, Btn, Card, Row, Screen, Sm, Stage, Sub, money } from "@/components/phone/parts";
import { firstName } from "@/components/phone/screens/affiliate-tech";
import { outstandingFor } from "@/lib/am-home";
import { sentAgo, workOf } from "@/lib/proposal-outcome";
import { loadAmAccounts, loadAmFollowUps, loadAmSales, type FollowUp } from "@/lib/data/am-home";
import { loadFinanceDashboard } from "@/lib/data/finance";
import { listApplicants, type ApplicantRow } from "@/lib/data/hiring";
import { listBoardJobs } from "@/lib/data/job-board";
import { listProfiles } from "@/lib/data/team";
import { meScreenFor } from "@/lib/me-screen";
import { nextWorkDay } from "@/lib/work-days";
import { POSITIONS, positionFor } from "@/lib/hiring/positions";
import { stageLabel } from "@/lib/hiring/screening";
import type { BoardJob } from "@/lib/job-board";
import { loadSaltPrices } from "@/lib/data/salt-prices";
import { loadClosedProjects, type ClosedProject } from "@/lib/data/sales";
import { MINIMUM_TREATMENTS, type SaltPriceRow } from "@/lib/salt";
import { createClient } from "@/lib/supabase/server";
import { dateKeyIn } from "@/lib/time-zone";
import type { Profile } from "@/types/domain";

const TZ = "America/New_York";
const DAY = 86_400_000;
const dayLabel = (key: string) => new Date(`${key}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", day: "numeric", timeZone: "UTC" });
const shortDay = (key: string) => new Date(`${key}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
/** "Nov 23 to Dec 5", or "Dec 1 to 12" when both days are in one month. */
const spanLabel = (from: string, to: string) =>
  `${shortDay(from)} to ${from.slice(0, 7) === to.slice(0, 7) ? shortDay(to).replace(/^[A-Za-z]+ /, "") : shortDay(to)}`;
const timeOf = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: TZ }).replace(":00", "").replace(" AM", " am").replace(" PM", " pm");
const shortTime = (iso: string) => timeOf(iso).replace(" am", "a").replace(" pm", "p");
const last = (name: string) => name.trim().split(/\s+/).slice(-1)[0] || name;

/** Monday of this week, and every day (Mon to Sun) of this week and next. */
function twoWeeks(now: Date) {
  const today = dateKeyIn(now);
  const t = new Date(`${today}T12:00:00Z`);
  const monday = new Date(t.getTime() - ((t.getUTCDay() + 6) % 7) * DAY);
  const days: string[] = [];
  for (let i = 0; i < 14; i++) {
    const d = new Date(monday.getTime() + i * DAY);
    days.push(d.toISOString().slice(0, 10));
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
 * Hiring, Your schedule, Crew schedule, Business, the
 * link, wallet and stage. Every client name opens that client.
 */
export async function AccountManagerPhone({ profile }: { profile: Profile }) {
  const now = new Date();
  const weeks = twoWeeks(now);
  const [accounts, sales, applicants, board, visits, finance, lw, followUps, team, evals, saltPrices, closed] = await Promise.all([
    loadAmAccounts(profile, now).catch(() => null),
    loadAmSales(profile, now).catch(() => null),
    listApplicants(profile.organization_id).catch(() => [] as ApplicantRow[]),
    listBoardJobs().catch(() => [] as BoardJob[]),
    visitsBetween(profile, weeks.from, weeks.to).catch(() => [] as Visit[]),
    loadFinanceDashboard(profile.organization_id, now).catch(() => null),
    loadLinkAndWallet(profile),
    loadAmFollowUps(profile).catch(() => [] as FollowUp[]),
    listProfiles().catch(() => [] as Profile[]),
    loadAmEvaluations(profile, now).catch(() => ({ today: [] as EvalVisit[], upcoming: [] as EvalVisit[], toWriteUp: [] as EvalVisit[] })),
    loadSaltPrices(profile.organization_id).catch(() => [] as SaltPriceRow[]),
    loadClosedProjects(90, now).catch(() => [] as ClosedProject[]),
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
  // Everything else the account manager has to act on (Jordan, Nov 23: the
  // account manager sees everything again).
  for (const m of accounts?.messages ?? []) {
    items.push({ tag: "Reply", who: m.customerName, whoHref: `/jobs/${m.jobId}`, body: <div className="vx-q">&ldquo;{m.body}&rdquo;</div>, main: { label: "Reply", href: `/jobs/${m.jobId}` } });
  }
  for (const i of accounts?.issues ?? []) {
    items.push({ tag: "Callback", who: i.customerName, whoHref: `/clients/${i.customerId}`, body: <Row a="Issue" b={i.title} />, main: { label: "Set a time", href: `/clients/${i.customerId}` } });
  }
  for (const inv of accounts?.invoices ?? []) {
    items.push({
      tag: "Not paid",
      who: inv.customerName,
      whoHref: `/jobs/${inv.jobId}`,
      body: (
        <>
          <Row a="Invoice" b={money(inv.amount)} />
          <Row a="Sent" b={outstandingFor(inv, now)} />
        </>
      ),
      main: { label: "Open invoice", href: `/jobs/${inv.jobId}` },
    });
  }
  for (const l of sales?.leads ?? []) {
    items.push({
      tag: l.reason === "new" ? "New lead" : "Book evaluation",
      who: l.customerName,
      whoHref: `/jobs/${l.jobId}`,
      body: <Row a={l.address || "Asked"} b={l.why} />,
      main: { label: "Book it", href: `/jobs/${l.jobId}` },
    });
  }

  /* Your schedule ----------------------------------------------------- */
  const all = [...visits, ...interviewsOf(applicants, weeks.from, weeks.to)].sort((a, b) => a.at.localeCompare(b.at));
  const today = all.filter((v) => v.day === weeks.today);
  const nextVisit = today.find((v) => v.kind === "visit" && new Date(v.at).getTime() > now.getTime() - 60 * 60_000);

  /* Crew schedule ----------------------------------------------------- */
  const inWindow = board.filter((j) => !j.declined && j.workStartsOn && j.workStartsOn.slice(0, 10) >= weeks.from && j.workStartsOn.slice(0, 10) <= weeks.to && STATUS[j.status]);
  // Sold and not finished, with no date in the window: no date yet, or a date
  // that has already gone by. A job whose day passed without being finished is
  // still waiting, so it belongs here rather than dropping off the schedule.
  const waitList = board
    .filter(
      (j) =>
        !j.declined &&
        (j.status === "approved" || j.status === "in_progress") &&
        (!j.workStartsOn || j.workStartsOn.slice(0, 10) < weeks.from)
    )
    .sort((a, b) => (a.startsOn ?? "").localeCompare(b.startsOn ?? ""));
  const later = board
    .filter((j) => !j.declined && j.workStartsOn && j.workStartsOn.slice(0, 10) > weeks.to && j.status !== "completed")
    .sort((a, b) => (a.workStartsOn ?? "").localeCompare(b.workStartsOn ?? ""));
  // A crew is named for its lead: the technicians, and the owner who runs a truck too.
  const crewOptions: CrewOption[] = team
    .filter((p) => ["technician", "owner"].includes(meScreenFor(p) ?? ""))
    .map((p) => ({ id: p.id, name: firstName(p) }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const firstOpenDay = nextWorkDay(weeks.today);
  const toBook = sales?.leads ?? [];
  const toApprove = sales?.toApprove ?? [];
  const openProps = sales?.open ?? [];

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
      <div id="s-clients">
        <ClientSearch clients={clients} />
        <NewEstimate />
      </div>

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

      <Card title="Your schedule">
        {today.length ? (
          today.map((v) => (
            <Row key={`${v.kind}-${v.jobId}`} a={`${timeOf(v.at)} · ${v.name} · ${v.what}`} b={v.kind === "visit" ? "Paid visit" : "Interview"} href={v.kind === "visit" ? `/jobs/${v.jobId}` : `/admin/hiring/${v.jobId}`} />
          ))
        ) : (
          <Row a="Nothing booked today" />
        )}
        {nextVisit && <Btn href={`/jobs/${nextVisit.jobId}`}>Start {timeOf(nextVisit.at)} visit</Btn>}
        <Sub title={`Next 2 weeks · ${spanLabel(weeks.from, weeks.to)}`} sum={all.length}>
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

      <Card title="Evaluations" right={`${evals.today.length} today`}>
        {evals.today.length ? (
          evals.today.map((v) => <TodayVisit key={v.id} v={v} />)
        ) : (
          <Row a="No visits today" />
        )}
        <Sub title="To book" sum={toBook.length} open={toBook.length > 0 && evals.today.length === 0}>
          {toBook.length ? (
            toBook.map((l) => (
              <div key={l.jobId}>
                <Row a={`${l.customerName} · ${l.why}`} b={l.address} href={`/jobs/${l.jobId}`} />
                <BookVisit jobId={l.jobId} day={firstOpenDay} />
              </div>
            ))
          ) : (
            <Row a="Nobody waiting for a visit" />
          )}
        </Sub>
        <Sub title="Next 3 weeks" sum={evals.upcoming.length}>
          {evals.upcoming.length ? (
            evals.upcoming.map((v) => (
              <div key={v.id}>
                <Row a={`${dayLabel(dateKeyIn(new Date(v.evaluationDate)))} · ${timeOf(v.evaluationDate)} · ${v.name}`} b={v.what} href={`/jobs/${v.id}`} />
                <BookVisit jobId={v.id} day={dateKeyIn(new Date(v.evaluationDate))} time={hhmm(v.evaluationDate)} label="Move" canCancel />
              </div>
            ))
          ) : (
            <Row a="None booked" />
          )}
        </Sub>
        <Sub title="Visited, to price" sum={evals.toWriteUp.length}>
          {evals.toWriteUp.length ? (
            evals.toWriteUp.map((v) => (
              <div key={v.id}>
                <Row a={`${shortDay(dateKeyIn(new Date(v.evaluationDate)))} · ${v.name}`} b={v.what} href={`/jobs/${v.id}`} />
                <div className="vx-2b">
                  <EstimateButton jobId={v.id} label="Price it on the map" />
                  <FinishVisit jobId={v.id} />
                </div>
              </div>
            ))
          ) : (
            <Row a="Nothing waiting" />
          )}
        </Sub>
      </Card>

      <Card title="Proposals" right={`${toApprove.length + openProps.length} open`}>
        <Sub title="To approve and send" sum={toApprove.length} open={toApprove.length > 0}>
          {toApprove.length ? (
            toApprove.map((p) => (
              <div key={p.proposalId}>
                <Row a={`${p.customerName} · ${p.address}`} b={money(p.total)} href={`/jobs/${p.jobId}`} />
                <ProposalButtons jobId={p.jobId} status="needs_approval" />
              </div>
            ))
          ) : (
            <Row a="None waiting on approval" />
          )}
        </Sub>
        <Sub title="Sent, no answer yet" sum={openProps.length} open={openProps.length > 0}>
          {openProps.length ? (
            openProps.map((p) => (
              <div key={p.proposalId}>
                <Row a={`${p.customerName} · ${workOf(p.jobName)}`} b={money(p.total)} href={`/jobs/${p.jobId}`} />
                <Row a={sentAgo(p.sentAt, now)} b={p.expiresAt && new Date(p.expiresAt).getTime() < now.getTime() ? "Expired" : ""} />
                <ProposalButtons jobId={p.jobId} status="sent" />
              </div>
            ))
          ) : (
            <Row a="Nothing out" />
          )}
        </Sub>
      </Card>

      <ClosedProjects rows={closed} />

      <Card title="Crew schedule · next 2 weeks" right={spanLabel(weeks.from, weeks.to)}>
        <Sm>
          {inWindow.length} booked in the next 2 weeks, {waitList.length} on the wait list. Tap a day to jump to it.
        </Sm>
        <CrewCalendar
          days={weeks.days}
          today={weeks.today}
          booked={inWindow.sort((a, b) => (a.workStartsOn ?? "").localeCompare(b.workStartsOn ?? ""))}
          waitList={waitList}
          later={later}
          crews={crewOptions}
          firstOpenDay={firstOpenDay}
          canEdit
        />
      </Card>

      {saltPrices.length > 0 && <SaltPrices rows={saltPrices} />}

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
    </Screen>
  );
}

/**
 * Residential salting, per application, to quote a client by text or on a
 * proposal. A price the owner hasn't set yet is worked out from cost and
 * said so, so nobody quotes it as if it were confirmed.
 */
function SaltPrices({ rows }: { rows: SaltPriceRow[] }) {
  const unset = rows.some((r) => !r.setPrice);
  return (
    <Card title="Salting prices" right="Residential">
      {rows.map((r) => (
        <Row key={r.surface} a={r.label} b={`${money(r.perApplicationCents / 100)} each`} />
      ))}
      <Sm>
        Per application. {MINIMUM_TREATMENTS} applications is the minimum, paid up front (driveway and walkways: {money(rows[0].minimumCents / 100)}). Snow removal is priced
        separately.
      </Sm>
      {unset && <Sm>Not confirmed yet: these are worked out from cost until the owner sets the residential price.</Sm>}
    </Card>
  );
}

const hhmm = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: TZ });

/** A visit today: who and where, directions and a call, then the steps, then pricing once there. */
function TodayVisit({ v }: { v: EvalVisit }) {
  const tel = v.phone && !v.doNotContact ? v.phone.replace(/[^\d+]/g, "") : null;
  const done = v.stage === "submitted";
  return (
    <div className="vx-visit">
      <Row a={`${timeOf(v.evaluationDate)} · ${v.name}`} b={done ? "Done" : v.what} href={`/jobs/${v.id}`} />
      {v.address && <Row a={v.address} b="Directions ›" href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(v.address)}`} />}
      {tel && <Row a="Call or text them" b="Call ›" href={`tel:${tel}`} />}
      {!done && <VisitSteps jobId={v.id} stage={v.stage} />}
      {(v.stage === "arrived" || done) && v.jobStatus === "estimating" && <EstimateButton jobId={v.id} label="Price it on the map" />}
      {v.stage === "booked" && <BookVisit jobId={v.id} day={dateKeyIn(new Date(v.evaluationDate))} time={hhmm(v.evaluationDate)} label="Move" canCancel />}
    </div>
  );
}

const JOB_STATUS: Record<string, string> = { completed: "Done", in_progress: "In progress", approved: "Not started", scheduled: "Scheduled" };

/** Sold in the last 90 days: who, what, how much, and how much is paid. */
function ClosedProjects({ rows }: { rows: ClosedProject[] }) {
  const sold = rows.reduce((n, r) => n + r.total, 0);
  return (
    <Card title="Closed projects" right={`${rows.length} in 90 days`}>
      <Big>{money(sold)}</Big>
      <Sm>sold in the last 90 days</Sm>
      {rows.length ? (
        rows.map((r) => (
          <Row
            key={r.jobId}
            a={
              <>
                <b style={{ fontSize: 15 }}>{r.customerName}</b>
                <br />
                <span style={{ fontSize: 14 }}>{r.work}</span>
                <br />
                <small className="vx-sm">
                  {r.closedOn ? `Sold ${shortDay(r.closedOn)} · ` : ""}
                  {JOB_STATUS[r.status] ?? r.status} · {r.paid >= r.total - 0.5 ? "Paid in full" : `${money(r.paid)} paid`}
                </small>
              </>
            }
            b={money(r.total)}
            href={`/jobs/${r.jobId}`}
          />
        ))
      ) : (
        <Row a="Nothing sold in the last 90 days." />
      )}
    </Card>
  );
}
