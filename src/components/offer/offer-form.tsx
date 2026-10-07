"use client";

import { useState, useTransition } from "react";
import { CheckCircle2 } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { bookOffer } from "@/lib/actions/offer-actions";

const TIMINGS = [
  { key: "asap", label: "As soon as possible" },
  { key: "two_weeks", label: "Within two weeks" },
  { key: "month", label: "Any time this month" },
];

/**
 * One button, and a line about timing.
 *
 * No date picker: the crew batches aeration by neighbourhood and the date
 * comes back from the office. Asking somebody to choose a day they cannot
 * know we can do is a form that ends in a phone call anyway.
 */
export function OfferForm({
  code,
  open,
  bookedJobId,
  phone,
}: {
  code: string;
  open: boolean;
  bookedJobId: string | null;
  phone: string | null;
}) {
  const [timing, setTiming] = useState("asap");
  const [notes, setNotes] = useState("");
  const [done, setDone] = useState<boolean>(Boolean(bookedJobId));
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function book() {
    setError(null);
    start(async () => {
      const result = await bookOffer({ code, timing, notes });
      if (!result.ok) return setError(result.error);
      setDone(true);
      window.scrollTo({ top: 0 });
    });
  }

  if (done) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-xl border border-border bg-card p-6 text-center">
        <CheckCircle2 className="h-10 w-10 text-primary" />
        <p className="text-lg font-semibold">You are booked</p>
        <p className="text-sm text-muted-foreground">
          Your credit is applied. We will be in touch within a day to set the date. Nothing to pay until the work is done.
        </p>
        {phone && <p className="text-xs text-muted-foreground">Questions: call or text {phone}.</p>}
      </div>
    );
  }

  if (!open) {
    return (
      <p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm">
        Still want it done? {phone ? `Call or text ${phone}` : "Reply to the email"} and we will sort it out.
      </p>
    );
  }

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        book();
      }}
    >
      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-semibold">When would suit?</legend>
        <div className="flex flex-wrap gap-2">
          {TIMINGS.map((t) => (
            <button
              key={t.key}
              type="button"
              disabled={pending}
              aria-pressed={timing === t.key}
              onClick={() => setTiming(t.key)}
              className={cn(
                "min-h-11 rounded-full border px-4 text-sm",
                timing === t.key ? "border-primary bg-primary/10 font-medium text-primary" : "border-border bg-background"
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
      </fieldset>
      <label htmlFor="offer-notes" className="flex flex-col gap-1">
        <span className="text-sm font-semibold">Anything we should know?</span>
        <Textarea
          id="offer-notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          disabled={pending}
          placeholder="Gate code, a dog, a part of the lawn to skip"
          className="text-base"
        />
      </label>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button type="submit" disabled={pending} className="min-h-12 w-full text-base">
        {pending ? "Booking" : "Book it with my credit"}
      </Button>
      <p className="text-center text-xs text-muted-foreground">Nothing to pay now. Cancel any time before the visit by replying to the email.</p>
    </form>
  );
}
