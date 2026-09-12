"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AlertTriangle, Check, Loader2, Pencil, Square, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  adjustEntry,
  clockSomebodyOut,
  deleteEntry,
} from "@/lib/actions/time-clock-actions";
import {
  dayByPerson,
  dayWageTotal,
  describeHours,
  hoursByJob,
  hoursOn,
  isOpen,
  onTheClock,
  overlapping,
  type Person,
  type TimeEntry,
} from "@/lib/time-clock";

function money(value: number): string {
  return value.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  });
}

function clock(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

/** A timestamp in the shape a datetime-local input wants, in local time. */
function forInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * Who is on what, for how long, and what the day cost.
 *
 * Ordered the way the questions get asked: who is on right now, then what
 * everybody's day adds up to, then where the hours went. Times can be
 * corrected, because the clock records when somebody pressed a button and
 * payroll runs on when they actually worked.
 */
export function Timesheet({
  entries,
  people,
  day,
}: {
  entries: TimeEntry[];
  people: Person[];
  day: string;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<TimeEntry | null>(null);

  const open = onTheClock(entries);
  const days = dayByPerson(entries, people);
  const jobs = hoursByJob(entries);
  const clashes = new Set(overlapping(entries).map((e) => e.id));
  const wages = dayWageTotal(days);
  const totalHours = days.reduce((sum, d) => sum + d.hours, 0);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-3 gap-2">
        <Stat label="On the clock" value={String(open.length)} />
        <Stat label="Hours today" value={describeHours(totalHours)} />
        <Stat label="Wages today" value={wages > 0 ? money(wages) : "—"} />
      </div>

      <div className="flex items-center gap-2">
        <label htmlFor="timesheet-day" className="text-sm text-muted-foreground">
          Day
        </label>
        <Input
          id="timesheet-day"
          type="date"
          value={day}
          className="h-9 w-44"
          onChange={(event) => router.push(`/admin/payments?day=${event.target.value}`)}
        />
      </div>

      {clashes.size > 0 && (
        <p className="flex items-start gap-2 rounded-lg bg-amber-500/15 px-3 py-2 text-sm text-amber-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          Somebody is logged in two places at once — usually a missed clock-out. The rows are marked
          below; correcting one fixes the totals.
        </p>
      )}

      <section>
        <h3 className="mb-2 text-sm font-semibold">On the clock now ({open.length})</h3>
        {open.length === 0 ? (
          <Empty>Nobody is clocked in.</Empty>
        ) : (
          <ul className="space-y-2">
            {open.map((entry) => (
              <li
                key={entry.id}
                className="flex items-center gap-3 rounded-xl border border-emerald-600/40 bg-emerald-50/40 p-3"
              >
                <span className="relative flex h-2.5 w-2.5 shrink-0">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-60" />
                  <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-600" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{entry.personName}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {entry.jobId ? (
                      <Link href={`/jobs/${entry.jobId}`} className="hover:underline">
                        {entry.jobName ?? "Job"}
                      </Link>
                    ) : (
                      "No job — yard or shop"
                    )}{" "}
                    · in at {clock(entry.clockedInAt)}
                  </p>
                </div>
                <span className="shrink-0 text-sm font-bold tabular-nums">
                  {describeHours(hoursOn(entry))}
                </span>
                <StopButton id={entry.id} onDone={() => router.refresh()} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h3 className="mb-2 text-sm font-semibold">The day, per person</h3>
        {days.length === 0 ? (
          <Empty>Nothing logged for this day.</Empty>
        ) : (
          <ul className="space-y-2">
            {days.map((personDay) => (
              <li
                key={personDay.profileId}
                className="rounded-xl border border-white/60 bg-card/60 p-3 backdrop-blur-md"
              >
                <div className="flex items-baseline justify-between gap-2">
                  <p className="text-sm font-medium">
                    {personDay.personName}
                    {personDay.stillOn && (
                      <span className="ml-1.5 text-xs font-normal text-emerald-700">still on</span>
                    )}
                  </p>
                  <p className="text-sm font-bold tabular-nums">
                    {describeHours(personDay.hours)}
                    {personDay.pay != null && (
                      <span className="ml-2 font-normal text-muted-foreground">
                        {money(personDay.pay)}
                      </span>
                    )}
                  </p>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  {personDay.pay != null
                    ? `${money(personDay.ratePerHour ?? 0)}/hr`
                    : personDay.payType === "commission"
                      ? "On commission — not paid by the hour"
                      : "No hourly rate on file"}
                </p>

                <ul className="mt-2 space-y-1">
                  {personDay.entries.map((entry) => (
                    <li
                      key={entry.id}
                      className={`flex items-center gap-2 rounded-lg border px-2 py-1.5 text-xs ${
                        clashes.has(entry.id) ? "border-amber-500/60 bg-amber-50/50" : "border-border"
                      }`}
                    >
                      <span className="min-w-0 flex-1 truncate">
                        {clock(entry.clockedInAt)} –{" "}
                        {entry.clockedOutAt ? clock(entry.clockedOutAt) : "still on"}
                        <span className="text-muted-foreground">
                          {" · "}
                          {entry.jobName ?? "No job"}
                        </span>
                        {entry.editedByName && (
                          <span className="text-muted-foreground"> · edited by {entry.editedByName}</span>
                        )}
                      </span>
                      <span className="shrink-0 tabular-nums">{describeHours(hoursOn(entry))}</span>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="h-6 px-1.5"
                        onClick={() => setEditing(entry)}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </section>

      {jobs.length > 0 && (
        <section>
          <h3 className="mb-2 text-sm font-semibold">Where the hours went</h3>
          <ul className="space-y-1">
            {jobs.map((job) => (
              <li
                key={job.jobId}
                className="flex items-center justify-between gap-2 rounded-lg border border-white/60 bg-card/60 px-3 py-2 text-sm backdrop-blur-md"
              >
                <Link href={`/jobs/${job.jobId}`} className="min-w-0 flex-1 truncate hover:underline">
                  {job.jobName}
                </Link>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {job.peopleCount} {job.peopleCount === 1 ? "person" : "people"}
                </span>
                <span className="shrink-0 font-bold tabular-nums">{describeHours(job.hours)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {editing && (
        <EditEntry
          entry={editing}
          onClose={() => setEditing(null)}
          onDone={() => {
            setEditing(null);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/60 bg-card/60 px-3 py-2 backdrop-blur-md">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-lg font-bold tabular-nums">{value}</p>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-lg border border-white/60 bg-card/60 px-3 py-2 text-sm text-muted-foreground backdrop-blur-md">
      {children}
    </p>
  );
}

function StopButton({ id, onDone }: { id: string; onDone: () => void }) {
  const [pending, startTransition] = useTransition();
  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      className="h-7 shrink-0 text-xs"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          await clockSomebodyOut(id);
          onDone();
        })
      }
    >
      {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Square className="h-3.5 w-3.5" />}
    </Button>
  );
}

/**
 * Correcting a logged time.
 *
 * The clock records when somebody pressed a button. Payroll runs on when they
 * actually worked, and those are not always the same — so this exists, and it
 * writes down who changed it.
 */
function EditEntry({
  entry,
  onClose,
  onDone,
}: {
  entry: TimeEntry;
  onClose: () => void;
  onDone: () => void;
}) {
  const [inAt, setInAt] = useState(forInput(entry.clockedInAt));
  const [outAt, setOutAt] = useState(entry.clockedOutAt ? forInput(entry.clockedOutAt) : "");
  const [note, setNote] = useState(entry.note ?? "");
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function run(work: () => Promise<{ ok: boolean; message?: string }>) {
    setMessage(null);
    startTransition(async () => {
      const result = await work();
      if (result.ok) onDone();
      else setMessage(result.message ?? "That didn't work.");
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-4 shadow-xl">
        <h2 className="text-lg font-semibold">{entry.personName}</h2>
        <p className="mb-3 text-xs text-muted-foreground">
          {entry.jobName ?? "No job"} · change these to what actually happened.
        </p>

        <div className="space-y-3">
          <div>
            <label htmlFor="in-at" className="text-xs text-muted-foreground">
              Clocked in
            </label>
            <Input
              id="in-at"
              type="datetime-local"
              value={inAt}
              onChange={(event) => setInAt(event.target.value)}
            />
          </div>
          <div>
            <label htmlFor="out-at" className="text-xs text-muted-foreground">
              Clocked out — leave blank to keep them on
            </label>
            <Input
              id="out-at"
              type="datetime-local"
              value={outAt}
              onChange={(event) => setOutAt(event.target.value)}
            />
          </div>
          <Input
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Why it changed"
          />

          {message && (
            <p className="rounded-lg bg-red-500/15 px-3 py-2 text-sm text-red-700">{message}</p>
          )}

          <div className="flex gap-2">
            <Button
              type="button"
              className="flex-1"
              disabled={pending}
              onClick={() =>
                run(() =>
                  adjustEntry({
                    id: entry.id,
                    clockedInAt: new Date(inAt).toISOString(),
                    clockedOutAt: outAt ? new Date(outAt).toISOString() : null,
                    note,
                  })
                )
              }
            >
              {pending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Check className="mr-2 h-4 w-4" />
              )}
              Save
            </Button>
            {!isOpen(entry) && (
              <Button
                type="button"
                variant="outline"
                disabled={pending}
                onClick={() => run(() => deleteEntry(entry.id))}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
            <Button type="button" variant="ghost" onClick={onClose}>
              Close
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
