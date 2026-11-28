import Link from "next/link";

import { ScheduleJob, type CrewOption } from "@/components/phone/schedule-job";
import type { Appointment } from "@/lib/data/schedule";
import type { BoardJob } from "@/lib/job-board";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
/** One color per crew, in the order the crews are listed. */
const CREW_COLORS = ["#0f766e", "#7c3aed", "#c2410c", "#2563eb", "#be185d", "#4d7c0f"];

const dayNum = (key: string) => Number(key.slice(8, 10));
const longDay = (key: string) =>
  new Date(`${key}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric", timeZone: "UTC" });
const shortDay = (key: string) =>
  new Date(`${key}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

const timeOf = (iso: string) =>
  new Date(iso)
    .toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" })
    .replace(":00", "");

const STATUS: Record<string, string> = { completed: "Done", in_progress: "In progress", approved: "Not started" };

export function crewKey(j: BoardJob): string {
  return j.assignedToId ?? "none";
}

export function crewName(j: BoardJob): string {
  return j.assignedToName ? `${j.assignedToName.split(/[\s@]/)[0].replace(/^./, (c) => c.toUpperCase())}'s crew` : "No crew yet";
}

/**
 * The Crew schedule: the next two weeks as a calendar (Mon to Sat), each day
 * showing who is booked, then the same days written out in full, then the
 * wait list. Every booking says what we're doing there, in plain words.
 */
export function CrewCalendar({
  days,
  today,
  booked,
  waitList,
  later,
  crews,
  firstOpenDay,
  appointments = [],
  canEdit = false,
}: {
  /** Work days in the window, Monday first, Sundays left out. */
  days: string[];
  today: string;
  booked: BoardJob[];
  waitList: BoardJob[];
  later: BoardJob[];
  crews: CrewOption[];
  firstOpenDay: string;
  /** Site visits and interviews, shown on the same calendar in their own style. */
  appointments?: Appointment[];
  /** Move and Schedule buttons: the account manager and up only. */
  canEdit?: boolean;
}) {
  const apptsByDay = new Map<string, Appointment[]>();
  for (const a of [...appointments].sort((x, y) => x.at.localeCompare(y.at))) {
    apptsByDay.set(a.day, [...(apptsByDay.get(a.day) ?? []), a]);
  }
  const byDay = new Map<string, BoardJob[]>();
  for (const j of booked) {
    const d = j.workStartsOn!.slice(0, 10);
    byDay.set(d, [...(byDay.get(d) ?? []), j]);
  }
  const crewOrder: string[] = [];
  for (const j of booked) if (!crewOrder.includes(crewKey(j))) crewOrder.push(crewKey(j));
  const color = (j: BoardJob) => (j.assignedToId ? CREW_COLORS[crewOrder.indexOf(crewKey(j)) % CREW_COLORS.length] : "#6b7280");
  const legend = crewOrder.map((k) => booked.find((j) => crewKey(j) === k)!);

  return (
    <div className="vx-cal">
      <div className="vx-cal-grid" role="grid" aria-label="Booked jobs, next 2 weeks">
        {WEEKDAYS.map((w) => (
          <div key={w} className="vx-cal-wd">
            {w}
          </div>
        ))}
        {days.map((d) => {
          const jobs = byDay.get(d) ?? [];
          const appts = apptsByDay.get(d) ?? [];
          return (
            <a key={d} href={`#day-${d}`} className={`vx-cal-day${d === today ? " is-today" : ""}${d < today ? " is-past" : ""}`}>
              <span className="vx-cal-n">{dayNum(d)}</span>
              {appts.map((a) => (
                <span key={`${a.kind}-${a.id}`} className="vx-cal-chip is-appt">
                  {a.name.split(" ")[0]}
                </span>
              ))}
              {jobs.map((j) => (
                <span key={j.id} className="vx-cal-chip" style={{ background: color(j) }}>
                  {(j.customerName ?? "Client").split(" ")[0]}
                </span>
              ))}
            </a>
          );
        })}
      </div>
      {(legend.length > 0 || appointments.length > 0) && (
        <div className="vx-cal-legend">
          {legend.map((j) => (
            <span key={crewKey(j)}>
              <i style={{ background: color(j) }} />
              {crewName(j)}
            </span>
          ))}
          {appointments.length > 0 && (
            <span>
              <i className="is-appt" />
              Site visits and interviews
            </span>
          )}
        </div>
      )}

      {days
        .filter((d) => (byDay.get(d) ?? []).length > 0 || (apptsByDay.get(d) ?? []).length > 0)
        .map((d) => (
          <section key={d} id={`day-${d}`} className="vx-cal-agenda">
            <h4>
              {longDay(d)}
              {d === today ? " · Today" : ""}
            </h4>
            {(apptsByDay.get(d) ?? []).map((a) => (
              <AppointmentLine key={`${a.kind}-${a.id}`} a={a} />
            ))}
            {(byDay.get(d) ?? []).map((j) => (
              <Booking key={j.id} j={j} dot={color(j)} note={`${crewName(j)} · ${STATUS[j.status] ?? j.status}`}>
                {canEdit && j.status !== "completed" && (
                  <ScheduleJob jobId={j.id} crews={crews} start={d} leadId={j.assignedToId} label="Move" />
                )}
              </Booking>
            ))}
          </section>
        ))}

      <section className="vx-cal-agenda">
        <h4>Wait list · {waitList.length}</h4>
        {waitList.length === 0 ? (
          <p className="vx-cal-empty">Nobody waiting.</p>
        ) : (
          waitList.map((j, i) => (
            <Booking
              key={j.id}
              j={j}
              n={i + 1}
              note={[
                j.workStartsOn ? `Was set for ${shortDay(j.workStartsOn.slice(0, 10))}` : j.status === "in_progress" ? "Started, no date" : "No date yet",
                j.assignedToName ? crewName(j) : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            >
              {canEdit && <ScheduleJob jobId={j.id} crews={crews} start={firstOpenDay} leadId={j.assignedToId} />}
            </Booking>
          ))
        )}
      </section>

      {later.length > 0 && (
        <section className="vx-cal-agenda">
          <h4>Later · {later.length}</h4>
          {later.map((j) => (
            <Booking key={j.id} j={j} note={`${shortDay(j.workStartsOn!.slice(0, 10))} · ${crewName(j)}`}>
              {canEdit && <ScheduleJob jobId={j.id} crews={crews} start={j.workStartsOn!.slice(0, 10)} leadId={j.assignedToId} label="Move" />}
            </Booking>
          ))}
        </section>
      )}
    </div>
  );
}

function Booking({ j, n, dot, note, children }: { j: BoardJob; n?: number; dot?: string; note: string; children?: React.ReactNode }) {
  return (
    <div className="vx-cal-job">
      <Link href={`/jobs/${j.id}`} className="vx-cal-job-link">
        <span className="vx-cal-who">
          {dot && <i style={{ background: dot }} />}
          {n ? `${n}. ` : ""}
          {j.customerName ?? "Client"}
        </span>
        <span className="vx-cal-what">{j.name}</span>
        <span className="vx-cal-note">{note}</span>
      </Link>
      {children}
    </div>
  );
}

export function AppointmentLine({ a }: { a: Appointment }) {
  return (
    <div className="vx-cal-job">
      <Link href={a.href} className="vx-cal-job-link">
        <span className="vx-cal-who">
          <i className="is-appt" />
          {timeOf(a.at)} · {a.name}
        </span>
        <span className="vx-cal-what">{a.what}</span>
      </Link>
    </div>
  );
}
