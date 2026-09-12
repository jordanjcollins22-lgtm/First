"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronUp, Phone } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { recordProposalCall } from "@/lib/actions/proposal-call-actions";
import { callListHeadline, OUTCOME_LABEL, OUTCOMES, type CallList, type CallOutcome, type RankedCall } from "@/lib/call-list";

/**
 * The calls to make, in order, with what to say on each.
 *
 * Built for a phone in one hand: the number is a tap, the outcome is a
 * tap, the note is one line, and Save closes the card. The script under
 * each card is a suggestion in the caller's own name, not a thing to read
 * out; it is there so the first sentence is never the hard part.
 */
export function CallListPanel({ list, callerFirstName }: { list: CallList; callerFirstName: string }) {
  const [showLater, setShowLater] = useState(false);

  return (
    <section className="mb-6 rounded-xl border border-white/60 bg-card/60 p-4 backdrop-blur-md">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-bold">Your calls</h2>
        <p className="text-sm text-muted-foreground">{callListHeadline(list)}</p>
      </div>
      <p className="mt-0.5 text-xs text-muted-foreground">
        Proposals sent and not answered, and proposals answered no. Biggest and warmest first. Tap one, ring them, tap what they said.
      </p>

      {list.now.length > 0 && (
        <ul className="mt-3 flex flex-col gap-2">
          {list.now.map((call) => (
            <CallCard key={call.proposalId} call={call} callerFirstName={callerFirstName} />
          ))}
        </ul>
      )}

      {list.later.length > 0 && (
        <div className="mt-3">
          <button
            type="button"
            onClick={() => setShowLater((v) => !v)}
            className="flex items-center gap-1 text-xs font-medium text-muted-foreground"
          >
            {showLater ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            {list.later.length} to call back later
          </button>
          {showLater && (
            <ul className="mt-2 flex flex-col gap-2">
              {list.later.map((call) => (
                <CallCard key={call.proposalId} call={call} callerFirstName={callerFirstName} later />
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

function CallCard({ call, callerFirstName, later = false }: { call: RankedCall; callerFirstName: string; later?: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [outcome, setOutcome] = useState<CallOutcome | null>(null);
  const [note, setNote] = useState("");
  const [callbackOn, setCallbackOn] = useState("");
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const needsDate = OUTCOMES.find((o) => o.key === outcome)?.needsDate ?? false;
  const tel = call.phone ? `tel:${call.phone.replace(/[^\d+]/g, "")}` : null;

  function save() {
    if (!outcome) return setError("Tap what they said first.");
    if (needsDate && !callbackOn) return setError("Pick the day to call back.");
    setError(null);
    start(async () => {
      const result = await recordProposalCall({ proposalId: call.proposalId, outcome, note, callbackOn: callbackOn || null });
      if (!result.ok) return setError(result.message);
      setDone(result.message);
      router.refresh();
    });
  }

  if (done) {
    return (
      <li className="rounded-lg border border-primary/40 bg-primary/5 px-3 py-2 text-sm">
        <span className="font-medium">{call.customerName}</span> · {done}
      </li>
    );
  }

  return (
    <li className={cn("rounded-lg border border-border bg-background/60", open && "border-primary/50")}>
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex w-full items-start gap-3 px-3 py-2.5 text-left">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="font-semibold">{call.customerName}</span>
            <span className="text-sm tabular-nums text-muted-foreground">{money(call.totalCents)}</span>
            <span
              className={cn(
                "rounded-full px-2 py-0.5 text-[11px] font-semibold",
                call.status === "sent" ? "bg-amber-100 text-amber-900 dark:bg-amber-500/20 dark:text-amber-200" : "bg-muted text-muted-foreground"
              )}
            >
              {call.status === "sent" ? "No answer yet" : "Said no"}
            </span>
            {later && call.dueOn && <span className="text-[11px] text-muted-foreground">back on {call.dueOn}</span>}
          </div>
          <p className="truncate text-xs text-muted-foreground">{call.address}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">{call.reason}</p>
          {call.lastCall && (
            <p className="mt-0.5 text-xs">
              Last call: <span className="font-medium">{OUTCOME_LABEL[call.lastCall.outcome]}</span>
              {call.lastCall.note && ` · “${call.lastCall.note}”`}
            </p>
          )}
        </div>
        {open ? <ChevronUp className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" /> : <ChevronDown className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" />}
      </button>

      {open && (
        <div className="flex flex-col gap-3 border-t border-border px-3 py-3">
          <div className="flex flex-wrap items-center gap-2">
            {tel ? (
              <a href={tel} className="inline-flex min-h-10 items-center gap-1.5 rounded-lg bg-primary px-3 text-sm font-semibold text-primary-foreground">
                <Phone className="h-4 w-4" /> Call {formatPhone(call.phone)}
              </a>
            ) : (
              <span className="text-sm text-muted-foreground">No phone number on file.</span>
            )}
            <Link href={`/jobs/${call.jobId}`} className="text-sm text-primary underline underline-offset-2">
              Open the job
            </Link>
          </div>

          {call.responseNote && (
            <p className="rounded-md bg-muted/60 px-3 py-2 text-sm">
              <span className="text-xs text-muted-foreground">When they said no they wrote: </span>“{call.responseNote}”
            </p>
          )}

          <div className="flex flex-col gap-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">What to say</p>
            {call.recommendations.map((rec, index) => (
              <div key={index} className="rounded-md border border-border px-3 py-2">
                <p className="text-sm font-medium">{rec.title}</p>
                {rec.say && (
                  <p className="mt-0.5 text-sm text-muted-foreground">“{rec.say.replace(/\{you\}/g, callerFirstName)}”</p>
                )}
                {rec.action && (
                  <Link href={rec.action.href} className="mt-1 inline-block text-xs text-primary underline underline-offset-2">
                    {rec.action.label}
                  </Link>
                )}
              </div>
            ))}
          </div>

          <div className="flex flex-col gap-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">What they said</p>
            <div className="flex flex-wrap gap-1.5">
              {OUTCOMES.map((option) => (
                <button
                  key={option.key}
                  type="button"
                  disabled={pending}
                  onClick={() => setOutcome(outcome === option.key ? null : option.key)}
                  title={option.hint}
                  className={cn(
                    "min-h-9 rounded-full border px-3 text-sm",
                    outcome === option.key ? "border-primary bg-primary/10 font-medium text-primary" : "border-border hover:bg-accent/50"
                  )}
                >
                  {option.label}
                </button>
              ))}
            </div>
            {outcome && <p className="text-xs text-muted-foreground">{OUTCOMES.find((o) => o.key === outcome)?.hint}</p>}
            {needsDate && (
              <label className="flex items-center gap-2 text-sm">
                <span>Call back on</span>
                <input
                  type="date"
                  value={callbackOn}
                  onChange={(e) => setCallbackOn(e.target.value)}
                  className="h-9 rounded-md border border-border bg-background px-2 text-sm"
                />
              </label>
            )}
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              placeholder="One line on what they said. Their words are better than yours."
              className="text-sm"
            />
          </div>

          {error && <p className="text-xs text-destructive">{error}</p>}
          <div className="flex gap-2">
            <Button type="button" size="sm" disabled={pending || !outcome} onClick={save}>
              {pending ? "Saving…" : "Save the call"}
            </Button>
            <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => setOpen(false)}>
              Close
            </Button>
          </div>
        </div>
      )}
    </li>
  );
}

function money(cents: number | null): string {
  if (cents == null) return "";
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

function formatPhone(raw: string | null): string {
  if (!raw) return "";
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10) return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  return raw;
}
