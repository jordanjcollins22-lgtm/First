"use client";

import { useState, useTransition } from "react";
import { CalendarCheck, CheckCircle2, CloudRain } from "lucide-react";

import { Button } from "@/components/ui/button";
import { chooseWorkDay } from "@/lib/actions/public-proposal-actions";
import { PREVIEW_BLOCKED } from "@/lib/proposal-flow";
import { dayLabel, windowNote, type WorkDayOption } from "@/lib/work-days";
import type { WorkDayOffer } from "@/lib/data/work-day-offer";

/**
 * The last screen: one tap on a day and they are booked.
 *
 * Blocked days are shown rather than hidden. A client who sees three greyed
 * out days with "rain likely" on them understands why; a client who sees a
 * calendar with holes in it assumes we are too busy for them.
 */
export function ScheduleView({
  token,
  offer,
  chosen,
  waitsForPayoff,
  justPaid,
  organizationName,
  preview,
}: {
  token: string;
  offer: WorkDayOffer | null;
  chosen: string | null;
  waitsForPayoff: boolean;
  justPaid: boolean;
  organizationName: string;
  preview: boolean;
}) {
  const [pending, start] = useTransition();
  const [booked, setBooked] = useState<string | null>(chosen);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function pick(day: WorkDayOption) {
    if (preview) {
      setError(PREVIEW_BLOCKED);
      return;
    }
    setError(null);
    setBusy(day.date);
    start(async () => {
      const result = await chooseWorkDay({ token, date: day.date });
      setBusy(null);
      if (result.ok) setBooked(result.date);
      else setError(result.message);
    });
  }

  const heading = (
    <div className="text-center">
      <p className="text-sm font-semibold uppercase tracking-wide text-primary">
        {organizationName}
      </p>
      {/* The moment the money lands, say what has happened to their job and
          who is picking it up. "Payment received" tells somebody their card
          worked and nothing about whether anybody is coming. */}
      {justPaid && !booked && (
        <div className="mt-3 rounded-xl border border-primary/30 bg-primary/5 p-3">
          <p className="flex items-center justify-center gap-1.5 text-sm font-semibold text-primary">
            <CheckCircle2 className="h-4 w-4" />
            Your booking is processed.
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            A team member will reach out to get your service booked in as soon as possible. Pick a
            day below if you already know one that suits you.
          </p>
        </div>
      )}
    </div>
  );

  if (booked) {
    return (
      <div className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-3 px-4 py-10 text-center">
        {heading}
        <CalendarCheck className="h-10 w-10 text-primary" />
        <h1 className="text-2xl font-bold">You are booked in.</h1>
        <p className="text-muted-foreground">
          We have you down for {dayLabel(booked)}. A team member will reach out to confirm the
          crew&apos;s arrival window, and if the weather turns we will call you rather than leave
          you waiting.
        </p>
      </div>
    );
  }

  if (waitsForPayoff) {
    return (
      <div className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-3 px-4 py-10 text-center">
        {heading}
        <CheckCircle2 className="h-10 w-10 text-primary" />
        <h1 className="text-2xl font-bold">Your booking is processed.</h1>
        <p className="text-muted-foreground">
          Your discount is safe. A team member will reach out to get your service booked in, and we
          will email your payment schedule. Once the final payment lands we will send you the days
          you can choose from, starting one month after that.
        </p>
      </div>
    );
  }

  const days = offer?.days ?? [];

  return (
    <div className="mx-auto flex max-w-md flex-col gap-4 px-4 py-10">
      {heading}

      <div className="text-center">
        <h1 className="text-2xl font-bold">Which day suits you?</h1>
        <p className="mt-1 text-sm text-muted-foreground">{windowNote(days)}</p>
      </div>

      {preview && (
        <div className="rounded-lg border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-center text-xs font-semibold text-amber-700">
          Internal preview. Nothing here books anybody.
        </div>
      )}

      {days.length === 0 && (
        <p className="text-center text-sm text-muted-foreground">
          We are working out the next open days for you. We will be in touch shortly.
        </p>
      )}

      <div className="flex flex-col gap-2">
        {days.map((day) => {
          const open = day.status === "open";
          return (
            <Button
              key={day.date}
              type="button"
              variant={open ? "outline" : "ghost"}
              disabled={!open || pending}
              onClick={() => pick(day)}
              className={`h-auto w-full justify-between px-4 py-3 ${
                open ? "" : "opacity-60"
              }`}
            >
              <span className="flex flex-col items-start">
                <span className="text-base font-semibold">{day.label}</span>
                {day.reason ? (
                  <span className="flex items-center gap-1 text-xs font-normal text-muted-foreground">
                    {day.status === "rain" && <CloudRain className="h-3 w-3" />}
                    {day.reason}
                  </span>
                ) : (
                  day.weatherLabel && (
                    <span className="text-xs font-normal text-muted-foreground">
                      {day.weatherLabel}
                      {day.precipChance != null ? `, ${day.precipChance}% rain` : ""}
                    </span>
                  )
                )}
              </span>
              <span className="text-sm font-semibold text-primary">
                {busy === day.date ? "Booking…" : open ? "Book" : ""}
              </span>
            </Button>
          );
        })}
      </div>

      {error && <p className="text-center text-sm text-destructive">{error}</p>}
    </div>
  );
}
