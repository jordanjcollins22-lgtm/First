"use client";

import { useState, useTransition } from "react";
import { AlertTriangle, CalendarPlus, Loader2, Pause, Play, Plus, Ticket, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { VisitLabour } from "@/components/job/visit-labour";
import type { Person, TimeEntry } from "@/lib/time-clock";
import {
  addWorkSession,
  deleteWorkSession,
  openTicket,
  setTicketStatus,
  setWorkSessionStatus,
  updateTicketCause,
} from "@/lib/actions/work-session-actions";
import {
  SESSION_STATUS_LABELS,
  TICKET_CAUSE_LABELS,
  TICKET_STATUS_LABELS,
  isTicketOpen,
  jobWindow,
} from "@/lib/scheduling";
import type {
  JobTicket,
  JobWorkSession,
  TicketCause,
  TicketSeverity,
  WorkSessionStatus,
} from "@/types/domain";

const CAUSES = Object.keys(TICKET_CAUSE_LABELS) as TicketCause[];

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function shortDate(value: string): string {
  return new Date(`${value}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/**
 * Every trip to this job, and everything still to go back for.
 *
 * A job used to be one start date and one end date, which cannot describe work
 * that pauses for weather or a back-ordered material, and cannot describe a job
 * that takes three separate trips. It is a list of visits now, and the job's
 * overall window follows from them automatically.
 */
export function VisitsPanel({
  jobId,
  sessions,
  tickets,
  timeEntries,
  people,
  canLogWork,
  canSeePay,
  allowTickets,
}: {
  jobId: string;
  sessions: JobWorkSession[];
  /** Hours logged against this job, so each visit can show its own. */
  timeEntries: TimeEntry[];
  people: Person[];
  canLogWork: boolean;
  canSeePay: boolean;
  tickets: JobTicket[];
  /** Raising a snag only makes sense once there is work to snag. Existing
   * tickets still show either way — history doesn't disappear. */
  allowTickets: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const window = jobWindow(sessions);
  const openTickets = tickets.filter((t) => isTicketOpen(t.status));

  function report(result: { ok: boolean; message?: string }) {
    if (result.ok) {
      setError(null);
      setMessage(result.message ?? null);
    } else {
      setMessage(null);
      setError(result.message ?? "That didn't work.");
    }
  }

  return (
    <section className="rounded-xl border border-white/60 bg-card/60 p-4 backdrop-blur-md">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold">
          <CalendarPlus className="h-4 w-4" />
          Visits &amp; tickets
        </h2>
        {window && (
          <span className="rounded-full border border-border bg-secondary/60 px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
            {shortDate(window.start)} – {shortDate(window.end)}
          </span>
        )}
        {openTickets.length > 0 && (
          <span className="flex items-center gap-1 rounded-full border border-amber-500/50 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-800">
            <AlertTriangle className="h-3 w-3" />
            {openTickets.length} open
          </span>
        )}
      </div>

      <SessionList
        jobId={jobId}
        sessions={sessions}
        tickets={tickets}
        timeEntries={timeEntries}
        people={people}
        canLogWork={canLogWork}
        canSeePay={canSeePay}
        onResult={report}
      />

      {(allowTickets || tickets.length > 0) && (
      <div className="mt-4 border-t border-border pt-3">
        <TicketList tickets={tickets} onResult={report} />
        {allowTickets && <NewTicket jobId={jobId} onResult={report} />}
      </div>
      )}

      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
      {message && <p className="mt-2 text-xs text-emerald-700">{message}</p>}
    </section>
  );
}

/* ------------------------------------------------------------------ visits */

function SessionList({
  jobId,
  sessions,
  timeEntries,
  people,
  canLogWork,
  canSeePay,
  tickets,
  onResult,
}: {
  jobId: string;
  sessions: JobWorkSession[];
  timeEntries: TimeEntry[];
  people: Person[];
  canLogWork: boolean;
  canSeePay: boolean;
  tickets: JobTicket[];
  onResult: (r: { ok: boolean; message?: string }) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [startsOn, setStartsOn] = useState(today());
  const [endsOn, setEndsOn] = useState(today());
  const [purpose, setPurpose] = useState("");
  const [ticketId, setTicketId] = useState("");
  const [isPending, startTransition] = useTransition();

  const bookable = tickets.filter((t) => isTicketOpen(t.status));

  return (
    <div>
      <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Visits
      </p>

      {sessions.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No visits booked. Add one for each trip — the job&apos;s dates follow along.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {sessions.map((session) => (
            <SessionRow
              timeEntries={timeEntries.filter((entry) => entry.sessionId === session.id)}
              people={people}
              canLogWork={canLogWork}
              canSeePay={canSeePay}
              key={session.id}
              session={session}
              ticket={tickets.find((t) => t.id === session.ticket_id) ?? null}
              onResult={onResult}
            />
          ))}
        </ul>
      )}

      {adding ? (
        <div className="mt-2 rounded-lg border border-border bg-muted/20 p-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-xs font-medium">
              Starts
              <Input type="date" value={startsOn} onChange={(e) => setStartsOn(e.target.value)} />
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium">
              Ends
              <Input type="date" value={endsOn} onChange={(e) => setEndsOn(e.target.value)} />
            </label>
          </div>

          <label className="mt-2 flex flex-col gap-1 text-xs font-medium">
            What this trip is for
            <Input
              value={purpose}
              onChange={(e) => setPurpose(e.target.value)}
              placeholder="Base prep and drainage"
            />
          </label>

          {bookable.length > 0 && (
            <label className="mt-2 flex flex-col gap-1 text-xs font-medium">
              Fixing a ticket?
              <select
                value={ticketId}
                onChange={(e) => setTicketId(e.target.value)}
                className="min-h-11 rounded-lg border border-border bg-background px-3 text-base sm:text-sm"
              >
                <option value="">No — regular work</option>
                {bookable.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.title}
                  </option>
                ))}
              </select>
            </label>
          )}

          <div className="mt-2 flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              className="min-h-11 sm:min-h-9"
              disabled={isPending}
              onClick={() =>
                startTransition(async () => {
                  const result = await addWorkSession(jobId, startsOn, endsOn, purpose, ticketId || null);
                  onResult(result);
                  if (result.ok) {
                    setAdding(false);
                    setPurpose("");
                    setTicketId("");
                  }
                })
              }
            >
              {isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              Book visit
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="min-h-11 sm:min-h-9"
              disabled={isPending}
              onClick={() => setAdding(false)}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="mt-2 flex min-h-9 items-center gap-1 text-xs font-medium text-primary hover:underline"
        >
          <Plus className="h-3.5 w-3.5" />
          Book another visit
        </button>
      )}
    </div>
  );
}

function SessionRow({
  session,
  ticket,
  timeEntries,
  people,
  canLogWork,
  canSeePay,
  onResult,
}: {
  session: JobWorkSession;
  ticket: JobTicket | null;
  timeEntries: TimeEntry[];
  people: Person[];
  canLogWork: boolean;
  canSeePay: boolean;
  onResult: (r: { ok: boolean; message?: string }) => void;
}) {
  const [pausing, setPausing] = useState(false);
  const [reason, setReason] = useState("");
  const [isPending, startTransition] = useTransition();

  function move(status: WorkSessionStatus, pauseReason: string | null = null) {
    startTransition(async () => {
      const result = await setWorkSessionStatus(session.id, status, pauseReason);
      onResult(result);
      if (result.ok) {
        setPausing(false);
        setReason("");
      }
    });
  }

  const tone =
    session.status === "paused"
      ? "border-amber-500/50 bg-amber-50/50"
      : session.status === "done"
        ? "border-emerald-600/40 bg-emerald-50/30"
        : session.status === "cancelled"
          ? "border-border bg-muted/30 opacity-60"
          : "border-border";

  return (
    <li className={`rounded-lg border p-2.5 ${tone}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5">
        <span className="text-sm font-medium">
          {shortDate(session.starts_on)}
          {session.ends_on !== session.starts_on && ` – ${shortDate(session.ends_on)}`}
        </span>
        <span className="text-[11px] font-semibold text-muted-foreground">
          {SESSION_STATUS_LABELS[session.status]}
        </span>
      </div>

      {session.purpose && <p className="text-xs text-muted-foreground">{session.purpose}</p>}

      {ticket && (
        <p className="mt-0.5 flex items-center gap-1 text-[11px] font-medium text-amber-800">
          <Ticket className="h-3 w-3" />
          Fixing: {ticket.title}
        </p>
      )}

      {session.status === "paused" && session.pause_reason && (
        <p className="mt-0.5 text-[11px] font-medium text-amber-800">
          Paused — {session.pause_reason}
        </p>
      )}

      {pausing ? (
        <div className="mt-2">
          <Input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Why did it stop? (rain, waiting on stone…)"
            autoFocus
          />
          <div className="mt-2 flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              className="min-h-9"
              disabled={isPending}
              onClick={() => move("paused", reason)}
            >
              Pause
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="min-h-9"
              disabled={isPending}
              onClick={() => setPausing(false)}
            >
              Never mind
            </Button>
          </div>
        </div>
      ) : (
        session.status !== "cancelled" && (
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            {session.status === "scheduled" && (
              <Action onClick={() => move("in_progress")} disabled={isPending}>
                <Play className="h-3 w-3" /> Start
              </Action>
            )}
            {session.status === "in_progress" && (
              <>
                <Action onClick={() => setPausing(true)} disabled={isPending}>
                  <Pause className="h-3 w-3" /> Pause
                </Action>
                <Action onClick={() => move("done")} disabled={isPending}>
                  Finish
                </Action>
              </>
            )}
            {session.status === "paused" && (
              <Action onClick={() => move("in_progress")} disabled={isPending}>
                <Play className="h-3 w-3" /> Resume
              </Action>
            )}
            {session.status !== "done" && (
              <Action onClick={() => move("cancelled")} disabled={isPending}>
                Call off
              </Action>
            )}
            <button
              type="button"
              disabled={isPending}
              aria-label="Remove visit"
              onClick={() =>
                startTransition(async () => {
                  onResult(await deleteWorkSession(session.id));
                })
              }
              className="ml-auto flex min-h-8 items-center gap-1 p-1 text-[11px] text-muted-foreground hover:text-destructive"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          </div>
        )
      )}
      <VisitLabour
        jobId={session.job_id}
        sessionId={session.id}
        startsOn={session.starts_on}
        entries={timeEntries}
        people={people}
        canEdit={canLogWork}
        canSeePay={canSeePay}
      />
    </li>
  );
}

function Action({
  children,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex min-h-8 items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] font-medium hover:bg-accent disabled:opacity-50"
    >
      {children}
    </button>
  );
}

/* ----------------------------------------------------------------- tickets */

function TicketList({
  tickets,
  onResult,
}: {
  tickets: JobTicket[];
  onResult: (r: { ok: boolean; message?: string }) => void;
}) {
  if (tickets.length === 0) return null;

  return (
    <div className="mb-3">
      <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Tickets
      </p>
      <ul className="flex flex-col gap-2">
        {tickets.map((ticket) => (
          <TicketRow key={ticket.id} ticket={ticket} onResult={onResult} />
        ))}
      </ul>
    </div>
  );
}

function TicketRow({
  ticket,
  onResult,
}: {
  ticket: JobTicket;
  onResult: (r: { ok: boolean; message?: string }) => void;
}) {
  const [resolving, setResolving] = useState(false);
  const [resolution, setResolution] = useState("");
  const [isPending, startTransition] = useTransition();

  const open = isTicketOpen(ticket.status);

  return (
    <li
      className={`rounded-lg border p-2.5 ${
        open ? "border-amber-500/50 bg-amber-50/40" : "border-border bg-muted/20"
      }`}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5">
        <span className="text-sm font-medium">{ticket.title}</span>
        <span className="text-[11px] font-semibold text-muted-foreground">
          {TICKET_STATUS_LABELS[ticket.status]}
        </span>
      </div>

      {ticket.detail && <p className="text-xs text-muted-foreground">{ticket.detail}</p>}

      <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px]">
        {ticket.severity === "urgent" && (
          <span className="rounded-full border border-destructive/40 bg-destructive/10 px-1.5 py-0.5 font-semibold text-destructive">
            Urgent
          </span>
        )}
        <span className="text-muted-foreground">
          {ticket.billable ? "Billable" : "On us"}
        </span>
      </div>

      {/* The cause is usually not known on the day, so it stays editable. */}
      <label className="mt-1.5 flex flex-col gap-1 text-[11px] font-medium">
        Why it happened
        <select
          value={ticket.cause ?? ""}
          disabled={isPending}
          onChange={(e) =>
            startTransition(async () => {
              onResult(
                await updateTicketCause(
                  ticket.id,
                  (e.target.value || null) as TicketCause | null,
                  ticket.billable
                )
              );
            })
          }
          className="min-h-10 rounded-lg border border-border bg-background px-2 text-base sm:text-xs"
        >
          <option value="">Not established yet</option>
          {CAUSES.map((cause) => (
            <option key={cause} value={cause}>
              {TICKET_CAUSE_LABELS[cause]}
            </option>
          ))}
        </select>
      </label>

      {ticket.resolution && (
        <p className="mt-1 text-[11px] text-muted-foreground">Fixed by: {ticket.resolution}</p>
      )}

      {open &&
        (resolving ? (
          <div className="mt-2">
            <Input
              value={resolution}
              onChange={(e) => setResolution(e.target.value)}
              placeholder="What did you do to fix it?"
              autoFocus
            />
            <div className="mt-2 flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                className="min-h-9"
                disabled={isPending}
                onClick={() =>
                  startTransition(async () => {
                    const result = await setTicketStatus(ticket.id, "resolved", resolution);
                    onResult(result);
                    if (result.ok) setResolving(false);
                  })
                }
              >
                Mark resolved
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="min-h-9"
                disabled={isPending}
                onClick={() => setResolving(false)}
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setResolving(true)}
            className="mt-1.5 flex min-h-8 items-center text-[11px] font-medium text-primary hover:underline"
          >
            Mark resolved
          </button>
        ))}
    </li>
  );
}

function NewTicket({
  jobId,
  onResult,
}: {
  jobId: string;
  onResult: (r: { ok: boolean; message?: string }) => void;
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [detail, setDetail] = useState("");
  const [cause, setCause] = useState<TicketCause | "">("");
  const [severity, setSeverity] = useState<TicketSeverity>("normal");
  const [billable, setBillable] = useState(false);
  const [isPending, startTransition] = useTransition();

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex min-h-9 items-center gap-1 text-xs font-medium text-primary hover:underline"
      >
        <Ticket className="h-3.5 w-3.5" />
        Raise a ticket
      </button>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-muted/20 p-3">
      <label className="flex flex-col gap-1 text-xs font-medium">
        What&apos;s wrong
        <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Paver settled by the step" autoFocus />
      </label>

      <label className="mt-2 flex flex-col gap-1 text-xs font-medium">
        Detail
        <Input
          value={detail}
          onChange={(e) => setDetail(e.target.value)}
          placeholder="Sank about an inch, client noticed after the rain"
        />
      </label>

      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-xs font-medium">
          Why (if known)
          <select
            value={cause}
            onChange={(e) => setCause(e.target.value as TicketCause | "")}
            className="min-h-11 rounded-lg border border-border bg-background px-3 text-base sm:text-sm"
          >
            <option value="">Not established yet</option>
            {CAUSES.map((c) => (
              <option key={c} value={c}>
                {TICKET_CAUSE_LABELS[c]}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-xs font-medium">
          Severity
          <select
            value={severity}
            onChange={(e) => setSeverity(e.target.value as TicketSeverity)}
            className="min-h-11 rounded-lg border border-border bg-background px-3 text-base sm:text-sm"
          >
            <option value="low">Low</option>
            <option value="normal">Normal</option>
            <option value="urgent">Urgent</option>
          </select>
        </label>
      </div>

      <label className="mt-2 flex cursor-pointer items-center gap-2 text-xs font-medium">
        <input
          type="checkbox"
          checked={billable}
          onChange={(e) => setBillable(e.target.checked)}
          className="h-4 w-4 accent-primary"
        />
        Billable to the client
      </label>

      <div className="mt-2 flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          className="min-h-11 sm:min-h-9"
          disabled={isPending}
          onClick={() =>
            startTransition(async () => {
              const result = await openTicket(jobId, {
                title,
                detail,
                cause: cause || null,
                severity,
                billable,
              });
              onResult(result);
              if (result.ok) {
                setOpen(false);
                setTitle("");
                setDetail("");
                setCause("");
                setBillable(false);
              }
            })
          }
        >
          {isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
          Open ticket
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="min-h-11 sm:min-h-9"
          disabled={isPending}
          onClick={() => setOpen(false)}
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}
