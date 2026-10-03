"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, Users } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { deleteEntry, logVisitWork } from "@/lib/actions/time-clock-actions";
import { dayByPerson, dayWageTotal, describeHours, type Person, type TimeEntry } from "@/lib/time-clock";

function money(value: number): string {
  return value.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

function clock(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

/**
 * Who worked this visit, and for how long.
 *
 * The rows are the clock's own — hours entered here reach payroll and the
 * job's cost by exactly the same road as hours somebody clocked, because
 * they are the same rows. A second place to write down hours would be a
 * second set of hours to disagree with the first.
 */
export function VisitLabour({
  jobId,
  sessionId,
  startsOn,
  entries,
  people,
  canEdit,
  canSeePay,
}: {
  jobId: string;
  sessionId: string;
  /** Defaults the times to the day the visit was, so it is two taps not six. */
  startsOn: string;
  entries: TimeEntry[];
  people: Person[];
  canEdit: boolean;
  canSeePay: boolean;
}) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [pending, startTransition] = useTransition();

  const days = dayByPerson(entries, people);
  const totalHours = days.reduce((sum, day) => sum + day.hours, 0);
  const wages = dayWageTotal(days);

  function run(work: () => Promise<{ ok: boolean; message?: string }>) {
    setMessage(null);
    startTransition(async () => {
      const result = await work();
      setFailed(!result.ok);
      setMessage(result.message ?? null);
      if (result.ok) {
        setAdding(false);
        router.refresh();
      }
    });
  }

  return (
    <div className="mt-2 border-t border-border/60 pt-2">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1 text-[11px] font-semibold text-muted-foreground">
          <Users className="h-3 w-3" />
          {entries.length === 0
            ? "Nobody logged yet"
            : `${days.length} ${days.length === 1 ? "person" : "people"} · ${describeHours(totalHours)}`}
          {canSeePay && wages > 0 && ` · ${money(wages)}`}
        </span>
        {canEdit && !adding && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-6 px-1.5 text-[11px]"
            onClick={() => setAdding(true)}
          >
            <Plus className="mr-0.5 h-3 w-3" />
            Who worked
          </Button>
        )}
      </div>

      {days.length > 0 && (
        <ul className="mt-1 space-y-0.5">
          {days.map((day) =>
            day.entries.map((entry) => (
              <li key={entry.id} className="flex items-center gap-2 text-[11px]">
                <span className="min-w-0 flex-1 truncate">
                  {day.personName}
                  <span className="text-muted-foreground">
                    {" · "}
                    {clock(entry.clockedInAt)} –{" "}
                    {entry.clockedOutAt ? clock(entry.clockedOutAt) : "still on"}
                  </span>
                </span>
                <span className="shrink-0 tabular-nums">
                  {describeHours(
                    entry.clockedOutAt
                      ? (new Date(entry.clockedOutAt).getTime() -
                          new Date(entry.clockedInAt).getTime()) /
                          3_600_000
                      : 0
                  )}
                </span>
                {canEdit && (
                  <button
                    type="button"
                    className="shrink-0 text-muted-foreground underline"
                    disabled={pending}
                    onClick={() => run(() => deleteEntry(entry.id))}
                  >
                    remove
                  </button>
                )}
              </li>
            ))
          )}
        </ul>
      )}

      {adding && (
        <AddWorker
          jobId={jobId}
          sessionId={sessionId}
          startsOn={startsOn}
          people={people}
          pending={pending}
          onSubmit={(input) => run(() => logVisitWork(input))}
          onCancel={() => setAdding(false)}
        />
      )}

      {message && (
        <p className={`mt-1 text-[11px] ${failed ? "text-red-700" : "text-emerald-700"}`}>{message}</p>
      )}
    </div>
  );
}

function AddWorker({
  jobId,
  sessionId,
  startsOn,
  people,
  pending,
  onSubmit,
  onCancel,
}: {
  jobId: string;
  sessionId: string;
  startsOn: string;
  people: Person[];
  pending: boolean;
  onSubmit: (input: {
    jobId: string;
    sessionId: string;
    profileId: string;
    startedAt: string;
    endedAt: string;
  }) => void;
  onCancel: () => void;
}) {
  const [profileId, setProfileId] = useState(people[0]?.id ?? "");
  // A crew day, as a starting point rather than a rule.
  const [from, setFrom] = useState(`${startsOn}T07:00`);
  const [to, setTo] = useState(`${startsOn}T15:00`);

  return (
    <div className="mt-2 space-y-1.5 rounded-lg border border-border bg-background/60 p-2">
      <select
        value={profileId}
        onChange={(event) => setProfileId(event.target.value)}
        className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs"
        aria-label="Who worked"
      >
        {people.map((person) => (
          <option key={person.id} value={person.id}>
            {person.name}
          </option>
        ))}
      </select>

      {/* Stacked on a phone: two datetime inputs side by side do not fit
          the width they are actually given. */}
      <div className="flex flex-col gap-1.5 sm:flex-row">
        <Input
          type="datetime-local"
          value={from}
          onChange={(event) => setFrom(event.target.value)}
          className="h-8 text-xs"
          aria-label="Started"
        />
        <Input
          type="datetime-local"
          value={to}
          onChange={(event) => setTo(event.target.value)}
          className="h-8 text-xs"
          aria-label="Finished"
        />
      </div>

      <div className="flex gap-1.5">
        <Button
          type="button"
          size="sm"
          className="h-7 flex-1 text-xs"
          disabled={pending || !profileId}
          onClick={() =>
            onSubmit({
              jobId,
              sessionId,
              profileId,
              startedAt: new Date(from).toISOString(),
              endedAt: new Date(to).toISOString(),
            })
          }
        >
          {pending ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : null}
          Log it
        </Button>
        <Button type="button" size="sm" variant="ghost" className="h-7 text-xs" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
