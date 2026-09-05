"use client";

import { useState, useTransition } from "react";
import { Briefcase, Loader2, Star, UserPlus, UserMinus, Users } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  assignCrewMember,
  setAccountManager,
  setJobLead,
  unassignCrewMember,
} from "@/lib/actions/job-crew-actions";
import { assignableAccountManagers, assignableProfiles, rosterView } from "@/lib/job-crew";
import { isCrew } from "@/lib/affiliate-roles";
import type { JobCrewMember, JobStatus, Profile } from "@/types/domain";

/**
 * Who is working this job.
 *
 * More than one person, because that is what a crew is — and because the Today
 * screen keys off this, so anybody left off it has no stops on their phone.
 */
export function CrewPanel({
  jobId,
  status,
  crew,
  profiles,
  editable,
  customerId,
  accountManagerId,
  setupNeeded = false,
}: {
  jobId: string;
  status: JobStatus;
  crew: JobCrewMember[];
  profiles: Profile[];
  /** The account manager is stored on the client, so changing it here changes
   * it for every job that client has. Said plainly in the UI. */
  customerId: string;
  accountManagerId: string | null;
  /** Closed jobs show their roster but do not let it be rewritten. */
  editable: boolean;
  /** The table isn't there yet. An empty roster and a missing table look
   * identical from here, and only one of them is fixed by adding somebody. */
  setupNeeded?: boolean;
}) {
  const [picking, setPicking] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const roster = rosterView(crew, profiles);
  const available = assignableProfiles(crew, profiles);
  // "Nobody has the crew role yet" and "they're all already on this job" are
  // different problems with different fixes, so they get different messages.
  const anyCrewExists = profiles.some((p) => isCrew(p.roles));
  const managers = assignableAccountManagers(profiles);
  const accountManager = profiles.find((p) => p.id === accountManagerId) ?? null;

  function run(work: () => Promise<{ ok: boolean; message?: string }>) {
    setError(null);
    startTransition(async () => {
      const result = await work();
      if (!result.ok) setError(result.message ?? "That didn't work.");
      else setPicking("");
    });
  }

  return (
    <section className="rounded-xl border border-white/60 bg-card/60 p-4 backdrop-blur-md">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold">
          <Users className="h-4 w-4" />
          Who&apos;s on this job
        </h2>
        {roster.length > 0 && (
          <span className="rounded-full border border-border bg-secondary/60 px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
            {roster.length} on this job
          </span>
        )}
      </div>

      {/* The account manager first: they own the client and the commission on
          the job, so "who is on this" starts with them and not the truck. */}
      <div className="mb-3 rounded-lg border border-border bg-background/60 p-2.5">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Account manager
        </p>
        {accountManager ? (
          <p className="flex items-center gap-1.5 text-sm font-medium">
            <Briefcase className="h-3.5 w-3.5 text-muted-foreground" />
            {accountManager.full_name || accountManager.email}
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">Nobody assigned</p>
        )}

        {editable && managers.length > 0 && (
          <>
            <select
              value={accountManagerId ?? ""}
              disabled={isPending}
              onChange={(e) =>
                run(() => setAccountManager(customerId, e.target.value || null, jobId))
              }
              className="mt-1.5 min-h-11 w-full rounded-lg border border-border bg-background px-3 text-base sm:text-sm"
            >
              <option value="">Nobody</option>
              {managers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.full_name || p.email}
                </option>
              ))}
            </select>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Set on the client — this applies to all of their jobs.
            </p>
          </>
        )}
        {editable && managers.length === 0 && (
          <p className="mt-1 text-[11px] text-muted-foreground">
            Nobody has the account manager role yet.
          </p>
        )}
      </div>

      {setupNeeded ? (
        <p className="rounded-lg border border-amber-400/60 bg-amber-50/60 px-3 py-2 text-xs">
          Crew assignment needs its database migration. In Supabase&apos;s SQL Editor, run{" "}
          <code>supabase/migrations/0083_job_crew.sql</code>, then reload this page.
        </p>
      ) : roster.length === 0 ? (
        <p className="mb-2 text-xs text-muted-foreground">
          Nobody assigned yet. Whoever you add sees this job on their Today screen.
        </p>
      ) : (
        <ul className="mb-2 flex flex-col gap-1.5">
          {roster.map((person) => (
            <li
              key={person.profileId}
              className="flex items-center gap-2 rounded-lg border border-border p-2"
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-bold">
                {initials(person.name)}
              </span>

              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{person.name}</p>
                {person.isLead && (
                  <p className="flex items-center gap-1 text-[11px] font-medium text-primary">
                    <Star className="h-3 w-3 fill-current" />
                    Lead
                  </p>
                )}
              </div>

              {editable && (
                <div className="flex shrink-0 items-center gap-1">
                  {!person.isLead && (
                    <button
                      type="button"
                      disabled={isPending}
                      onClick={() => run(() => setJobLead(jobId, person.profileId))}
                      className="flex min-h-9 items-center gap-1 rounded-md border border-border px-2 text-[11px] font-medium hover:bg-accent"
                    >
                      <Star className="h-3 w-3" />
                      Make lead
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={isPending}
                    aria-label={`Take ${person.name} off this job`}
                    onClick={() => run(() => unassignCrewMember(jobId, person.profileId))}
                    className="flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:text-destructive"
                  >
                    <UserMinus className="h-4 w-4" />
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {!setupNeeded && editable && available.length > 0 && (
        <div className="flex flex-col gap-2 sm:flex-row">
          <select
            value={picking}
            onChange={(e) => setPicking(e.target.value)}
            disabled={isPending}
            className="min-h-11 flex-1 rounded-lg border border-border bg-background px-3 text-base sm:text-sm"
          >
            <option value="">Add crew to this job…</option>
            {available.map((p) => (
              <option key={p.id} value={p.id}>
                {p.full_name || p.email}
              </option>
            ))}
          </select>
          <Button
            type="button"
            size="sm"
            className="min-h-11 sm:min-h-9"
            disabled={isPending || !picking}
            onClick={() => run(() => assignCrewMember(jobId, picking))}
          >
            {isPending ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
            ) : (
              <UserPlus className="mr-1.5 h-4 w-4" />
            )}
            Add
          </Button>
        </div>
      )}

      {!setupNeeded && editable && available.length === 0 && (
        <p className="text-[11px] text-muted-foreground">
          {anyCrewExists
            ? "Everybody with the crew role is already on this job."
            : "Nobody has the crew role yet — give it to somebody under Team & Services and they'll show up here."}
        </p>
      )}

      {!setupNeeded && !editable && (
        <p className="text-[11px] text-muted-foreground">
          {status === "completed"
            ? "This job is finished — its crew is part of the record now."
            : "This job is cancelled. Reopen it to change the crew."}
        </p>
      )}

      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
    </section>
  );
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}
