"use client";

import { useState, useTransition } from "react";
import { CalendarClock, MapPin } from "lucide-react";

import { Button } from "@/components/ui/button";
import { decideEarlyStart } from "@/lib/actions/early-start-actions";
import type { PendingEarlyStart } from "@/lib/data/early-start";

function when(date: string): string {
  const d = new Date(`${date}T00:00:00`);
  return Number.isNaN(d.getTime())
    ? date
    : d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

/**
 * Crews asking to bring a booked job forward.
 *
 * Sits at the top of the account manager's day because it is the only thing
 * on that page with a half-life: the crew are standing in a finished garden
 * now, and an answer tomorrow morning is the same as no answer.
 */
export function EarlyStartQueue({ requests }: { requests: PendingEarlyStart[] }) {
  if (requests.length === 0) return null;

  return (
    <section className="mb-4 rounded-2xl border border-amber-300/70 bg-amber-50/70 p-4 dark:border-amber-500/30 dark:bg-amber-500/10">
      <p className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-amber-900 dark:text-amber-200">
        <CalendarClock className="h-4 w-4" />
        {requests.length === 1
          ? "A crew finished early and wants the next job"
          : `${requests.length} crews finished early and want their next job`}
      </p>
      <ul className="flex flex-col gap-2">
        {requests.map((request) => (
          <RequestCard key={request.id} request={request} />
        ))}
      </ul>
    </section>
  );
}

function RequestCard({ request }: { request: PendingEarlyStart }) {
  const [pending, start] = useTransition();
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [answered, setAnswered] = useState<"approved" | "declined" | null>(null);

  function decide(approve: boolean) {
    setError(null);
    start(async () => {
      const result = await decideEarlyStart({ requestId: request.id, approve, reason });
      if (result.ok) setAnswered(approve ? "approved" : "declined");
      else setError(result.message);
    });
  }

  if (answered) {
    return (
      <li className="rounded-lg border border-border bg-background px-3 py-2 text-sm">
        {answered === "approved"
          ? `${request.customerName} moved to today. The crew can see it now.`
          : `Told them not this time.`}
      </li>
    );
  }

  return (
    <li className="rounded-lg border border-border bg-background p-3">
      <p className="text-sm font-semibold">{request.customerName}</p>
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <MapPin className="h-3 w-3 shrink-0" />
        <span className="truncate">{request.address}</span>
      </p>
      <p className="mt-1 text-xs text-muted-foreground">
        {request.crewName} · booked for {when(request.bookedFor)}
      </p>
      {request.note && <p className="mt-1.5 text-sm">&ldquo;{request.note}&rdquo;</p>}

      {declining ? (
        <div className="mt-2 flex flex-col gap-2">
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Why not? The crew sees this."
            className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
          />
          <div className="flex gap-2">
            <Button
              type="button"
              variant="ghost"
              className="flex-1"
              onClick={() => setDeclining(false)}
              disabled={pending}
            >
              Back
            </Button>
            <Button
              type="button"
              variant="destructive"
              className="flex-1"
              disabled={pending}
              onClick={() => decide(false)}
            >
              {pending ? "Sending…" : "Send"}
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-2 flex gap-2">
          <Button
            type="button"
            variant="outline"
            className="flex-1"
            disabled={pending}
            onClick={() => setDeclining(true)}
          >
            Not today
          </Button>
          <Button type="button" className="flex-1" disabled={pending} onClick={() => decide(true)}>
            {pending ? "Moving…" : "Approve"}
          </Button>
        </div>
      )}

      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
    </li>
  );
}
