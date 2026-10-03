/**
 * Not before eight and not after nine, wherever the client is.
 *
 * A text at half past six in the morning is a complaint, and enough of them
 * is a phone number the carriers stop delivering. It is also the rule in most
 * places that have one: a business may not text a consumer outside their
 * local daytime, and "local" means the client's clock, not the server's.
 *
 * A reminder held by this is not dropped. It waits for the window to open,
 * which is what somebody meant when they asked for a reminder the evening
 * before and the job got scheduled at midnight.
 */

/** The default window, in the business's own hours. */
export const QUIET_DEFAULTS = { startHour: 8, endHour: 21 } as const;

export interface QuietWindow {
  /** First hour a message may go out, 0 to 23. */
  startHour: number;
  /** Last hour a message may go out, exclusive: 21 means nothing after 20:59. */
  endHour: number;
  /** An IANA zone, like "America/New_York". */
  timeZone: string;
}

/**
 * The hour of the day at an instant, somewhere.
 *
 * Done with the browser and the server's own timezone database rather than a
 * stored offset, because an offset is wrong twice a year and nobody notices
 * until the clocks go back.
 */
export function hourIn(at: Date, timeZone: string): number {
  try {
    const hour = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour: "numeric",
      hour12: false,
    }).format(at);
    const parsed = Number(hour);
    // "24" is midnight in some locales' formatting of hourCycle h24.
    return Number.isFinite(parsed) ? parsed % 24 : at.getUTCHours();
  } catch {
    // An unknown zone is a settings mistake, and refusing to send anything
    // ever is a worse answer to it than falling back to the server's clock.
    return at.getUTCHours();
  }
}

/** Whether an instant falls outside the hours a client may be messaged. */
export function isQuiet(at: Date, window: QuietWindow): boolean {
  const hour = hourIn(at, window.timeZone);
  const { startHour, endHour } = window;
  // A window that wraps past midnight is somebody's night shift, not a
  // client's evening, but it costs nothing to read it correctly.
  if (startHour <= endHour) return hour < startHour || hour >= endHour;
  return hour < startHour && hour >= endHour;
}

/**
 * When this message may actually go.
 *
 * The same instant when it is already fine, and the start of the next window
 * when it is not. Minutes and seconds are dropped: nothing here needs to fire
 * at 08:00:00 exactly, and a whole hour is easier to reason about when
 * somebody asks why a text went at eight in the morning.
 */
export function nextAllowed(at: Date, window: QuietWindow): Date {
  if (!isQuiet(at, window)) return at;

  const step = new Date(at.getTime());
  // An hour at a time until the window opens. At most a day and a bit of
  // steps, and it is right across a daylight saving change, which arithmetic
  // on the offset is not.
  for (let i = 0; i < 48; i += 1) {
    step.setUTCMinutes(0, 0, 0);
    step.setUTCHours(step.getUTCHours() + 1);
    if (!isQuiet(step, window)) return step;
  }
  return at;
}

/** How the window reads on a settings screen. */
export function describeWindow(window: QuietWindow): string {
  const clock = (hour: number) => {
    const h = ((hour + 11) % 12) + 1;
    return `${h}${hour < 12 || hour === 24 ? "am" : "pm"}`;
  };
  return `${clock(window.startHour)} to ${clock(window.endHour)}, ${window.timeZone.split("/").pop()?.replace(/_/g, " ")} time`;
}
