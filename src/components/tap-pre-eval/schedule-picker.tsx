"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, CheckCircle2, Loader2, Video } from "lucide-react";

import { Button } from "@/components/ui/button";
import { RecommendedTimes } from "@/components/booking/recommended-times";
import { bookPaidEvaluationVisit } from "@/lib/actions/public-booking-actions";
import type { BookingTimes, OfferedTime } from "@/lib/data/booking-times";
import type { EvaluationTier } from "@/lib/evaluation-tiers";
import { cn } from "@/lib/utils";

export interface SchedulePickerProps {
  token: string;
  businessName: string;
  businessPhone: string | null;
  clientFirstName: string | null;
  paid: boolean;
  choice: "deposit" | "evaluation" | null;
  /** The visit they get: the one they paid for, or the one with their deposit. */
  tier: EvaluationTier | null;
  /** "Tuesday, November 3 at 10:00 am", once booked. */
  booked: string | null;
  times: BookingTimes | null;
  noticeText: string;
  /** Said when the visit is a video call, before they pick. */
  digital: string | null;
  estimateHref: string;
}

function dayLabel(dateKey: string): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
}

function timeLabel(time: string): string {
  const [h, m] = time.split(":").map(Number);
  return new Date(2000, 0, 1, h, m).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

/**
 * The last page of the funnel: they have paid, so now the visit. Recommended
 * times first (the ones next to a visit already nearby), every free time a
 * tap away, and a time is picked then confirmed so a slip of the thumb is
 * not a booking. Once booked, it says so and what happens next.
 */
export function SchedulePicker({
  token,
  businessName,
  businessPhone,
  clientFirstName,
  paid,
  choice,
  tier,
  booked,
  times,
  noticeText,
  digital,
  estimateHref,
}: SchedulePickerProps) {
  const router = useRouter();
  const [picked, setPicked] = useState<OfferedTime | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function confirm() {
    if (!picked) return;
    setError(null);
    startTransition(async () => {
      const result = await bookPaidEvaluationVisit({ token, date: picked.date, time: picked.time, candidateEvaluatorIds: picked.evaluatorIds });
      if (!result.ok) setError(result.error);
      else router.refresh();
    });
  }

  const header = (
    <div className="flex flex-col items-center gap-1 text-center">
      <p className="text-sm font-semibold uppercase tracking-wide text-primary">{businessName}</p>
    </div>
  );

  if (!paid) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 px-4 py-10 text-center">
        {header}
        <Loader2 className="mx-auto size-10 animate-spin text-primary" />
        <h1 className="text-2xl font-bold">Your payment is going through</h1>
        <p className="text-muted-foreground">This usually takes a few seconds.</p>
        <Button size="lg" onClick={() => router.refresh()}>
          Check again
        </Button>
      </main>
    );
  }

  if (booked) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col gap-6 px-4 py-10">
        {header}
        <div className="flex flex-col items-center gap-2 text-center">
          <CheckCircle2 className="size-14 text-primary" />
          <h1 className="text-3xl font-bold">You&apos;re booked{clientFirstName ? `, ${clientFirstName}` : ""}</h1>
          <p className="text-lg">{booked}</p>
        </div>
        {tier && (
          <section className="rounded-2xl border border-border p-4">
            <h2 className="font-semibold">{tier.name}</h2>
            <ul className="mt-2 flex flex-col gap-1.5 text-sm">
              {tier.includes.map((item) => (
                <li key={item} className="flex items-start gap-2">
                  <Check className="mt-0.5 size-4 shrink-0 text-primary" /> {item}
                </li>
              ))}
            </ul>
          </section>
        )}
        <section className="rounded-2xl border border-border p-4 text-sm">
          <h2 className="font-semibold">What happens next</h2>
          <ol className="mt-2 flex list-decimal flex-col gap-1.5 pl-5 text-muted-foreground">
            <li>We&apos;ve emailed you a confirmation.</li>
            <li>We come out at your time and look at everything with you.</li>
            <li>You get your final proposal, and we go over any changes together.</li>
            <li>
              We schedule the work.{" "}
              {choice === "evaluation" ? "What you paid today comes off the project." : "Your deposit comes off the final price."}
            </li>
          </ol>
        </section>
        <a href={estimateHref} className="text-center text-sm font-semibold text-primary underline-offset-2 hover:underline">
          See your estimate
        </a>
        {businessPhone && (
          <p className="text-center text-sm text-muted-foreground">
            Need a different time? Call or text <a className="font-semibold text-primary" href={`tel:${businessPhone}`}>{businessPhone}</a>
          </p>
        )}
      </main>
    );
  }

  const byDay = new Map<string, OfferedTime[]>();
  for (const t of times?.all ?? []) byDay.set(t.date, [...(byDay.get(t.date) ?? []), t]);
  const days = [...byDay.keys()].sort().slice(0, 14);

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col gap-5 px-4 py-8">
      {header}
      <div className="flex items-start gap-3 rounded-2xl border-2 border-primary/40! bg-primary/5 p-4">
        <CheckCircle2 className="mt-0.5 size-6 shrink-0 text-primary" />
        <div>
          <p className="font-semibold">{choice === "evaluation" ? `${tier?.name ?? "Evaluation"} paid. Thank you!` : "Deposit received. Thank you!"}</p>
          <p className="text-sm text-muted-foreground">Last step: pick when we come out.</p>
        </div>
      </div>

      {digital && (
        <div className="flex gap-2.5 rounded-lg border border-border bg-accent/40 px-3 py-2.5">
          <Video className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          <p className="text-sm text-muted-foreground">{digital}</p>
        </div>
      )}

      <div>
        <h1 className="text-xl font-bold">When suits you?</h1>
        <p className="text-sm text-muted-foreground">
          The soonest we can get to you.{noticeText && ` ${noticeText}`}
        </p>
      </div>

      {!showAll ? (
        <RecommendedTimes times={times?.recommended ?? []} loading={false} selected={picked} onPick={setPicked} onSeeAll={() => setShowAll(true)} />
      ) : (
        <div className="flex flex-col gap-4">
          {days.map((day) => (
            <div key={day}>
              <p className="mb-1.5 text-sm font-semibold">{dayLabel(day)}</p>
              <div className="flex flex-wrap gap-1.5">
                {byDay.get(day)!.map((t) => {
                  const on = picked?.date === t.date && picked?.time === t.time;
                  return (
                    <button
                      key={t.time}
                      type="button"
                      onClick={() => setPicked(t)}
                      className={cn(
                        "min-h-11 rounded-lg border px-3 text-sm font-medium",
                        on ? "border-primary! bg-primary text-primary-foreground" : "border-border bg-card hover:border-primary!"
                      )}
                    >
                      {timeLabel(t.time)}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
          <button type="button" onClick={() => setShowAll(false)} className="self-start py-2 text-sm text-muted-foreground underline">
            Back to the suggested times
          </button>
        </div>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button size="xl" className="w-full" disabled={!picked || isPending} onClick={confirm}>
        {isPending ? <Loader2 className="size-6 animate-spin" /> : picked ? `Confirm ${dayLabel(picked.date)} at ${timeLabel(picked.time)}` : "Pick a time above"}
      </Button>
    </main>
  );
}
