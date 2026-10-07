"use client";

import { bookingWarning, holidaysBetween, isClosedDay } from "@/lib/holidays";

/**
 * What a date is, when it is something.
 *
 * Beside the field rather than behind a confirm dialog: the moment to find out
 * that the ninth of September is Labor Day is while choosing it, not after
 * pressing save. It warns and never blocks -- a crew doing a commercial car
 * park on the Fourth is a real booking, and an app that refuses it is an app
 * somebody works around.
 *
 * Takes whatever the input holds, "YYYY-MM-DD" or a full datetime-local, so it
 * can sit under either kind of field without the caller trimming first.
 */
export function HolidayNotice({ value, className }: { value: string; className?: string }) {
  const date = value.slice(0, 10);
  if (date.length !== 10) return null;

  const warning = bookingWarning(date);
  if (!warning) return null;

  return (
    <p
      className={`text-[11px] ${
        isClosedDay(date) ? "font-medium text-amber-700" : "text-muted-foreground"
      } ${className ?? ""}`}
    >
      {warning}
    </p>
  );
}

/**
 * The holidays inside a booked range.
 *
 * A separate thing from the notice on each end, because the days that ruin a
 * week-long job are the ones in the middle of it, and nobody looks at those --
 * they pick a Monday and a Friday and never see the Thursday.
 */
export function HolidayRangeNotice({ start, end }: { start: string; end: string }) {
  const from = start.slice(0, 10);
  const to = end.slice(0, 10);
  if (from.length !== 10 || to.length !== 10) return null;

  // The ends have their own notice under their own field; this is only for
  // what falls between them.
  const inside = holidaysBetween(from, to).filter(
    (holiday) => holiday.observed !== from && holiday.observed !== to
  );
  if (inside.length === 0) return null;

  const closed = inside.filter((holiday) => holiday.kind === "federal");
  const names = inside.map((holiday) => holiday.name).join(", ");

  return (
    <p className={`text-[11px] ${closed.length > 0 ? "font-medium text-amber-700" : "text-muted-foreground"}`}>
      {closed.length > 0 ? "Falls across " : "Includes "}
      {names}.
    </p>
  );
}
