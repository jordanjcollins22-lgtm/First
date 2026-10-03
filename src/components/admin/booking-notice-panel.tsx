"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";

import { setBookingNotice } from "@/lib/actions/business-actions";
import { describeNoticeForOffice, MAX_NOTICE_HOURS } from "@/lib/booking-notice";

/**
 * How much warning a booked evaluation needs.
 *
 * Two controls and a sentence that reads them back, so what the rule will
 * do is on screen before Save is pressed. The sentence is the same one the
 * office sees afterwards, which is the point: no reading the settings and
 * working out the consequence in your head.
 */
export function BookingNoticePanel({
  initial,
}: {
  initial: { noticeHours: number; sameDay: boolean; timeZone: string };
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [noticeHours, setNoticeHours] = useState(String(initial.noticeHours));
  const [sameDay, setSameDay] = useState(initial.sameDay);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const preview = describeNoticeForOffice({
    noticeHours: Number(noticeHours) || 0,
    sameDay,
    timeZone: initial.timeZone,
  });

  function save() {
    setError(null);
    setSaved(false);
    start(async () => {
      const result = await setBookingNotice({ noticeHours, sameDay });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setSaved(true);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-white/60 bg-card/60 p-4 backdrop-blur-md">
      <p className="text-sm text-muted-foreground">
        What the public booking page is allowed to offer. Days are judged on the business&apos;s clock,
        so a booking at eleven at night still counts as today.
      </p>

      <label className="flex items-start gap-3">
        <input
          type="checkbox"
          checked={!sameDay}
          onChange={(e) => setSameDay(!e.target.checked)}
          className="mt-1 h-4 w-4"
          disabled={pending}
        />
        <span>
          <span className="block text-sm font-medium">No same-day visits</span>
          <span className="block text-xs text-muted-foreground">
            The earliest a client can book is tomorrow. Untick to let them take a free hour later today.
          </span>
        </span>
      </label>

      <label htmlFor="notice-hours" className="flex flex-col gap-1">
        <span className="text-xs font-medium">Hours of notice</span>
        <input
          id="notice-hours"
          type="number"
          inputMode="numeric"
          min={0}
          max={MAX_NOTICE_HOURS}
          value={noticeHours}
          onChange={(e) => setNoticeHours(e.target.value)}
          disabled={pending}
          className="h-10 w-32 rounded-md border border-border bg-background px-3 text-sm"
        />
        <span className="text-xs text-muted-foreground">
          Nothing inside this many hours of booking. 0 means only the same-day rule applies. 24 is a day, 48 is two.
        </span>
      </label>

      <p className="rounded-md bg-primary/10 px-3 py-2 text-sm text-primary">{preview}</p>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={pending}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
        >
          {pending ? "Saving…" : "Save"}
        </button>
        {saved && !pending && (
          <span className="flex items-center gap-1 text-sm text-primary">
            <Check className="h-4 w-4" /> Saved
          </span>
        )}
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
