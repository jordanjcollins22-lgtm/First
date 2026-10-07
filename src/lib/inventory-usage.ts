/**
 * What the movement log can tell you that a stock number cannot.
 *
 * A quantity on hand says where you are. It says nothing about how you got
 * there, and every question worth asking is about how you got there: how long
 * a toner lasts, who had the saw when it broke, whether a job used what it
 * was supposed to.
 *
 * All of it derived. Nothing here is stored, so nothing here can drift from
 * the movements it came from.
 */

export type Direction = "out" | "in" | "count";

export interface Movement {
  id: string;
  direction: Direction;
  quantity: number;
  /** Who did it. Null where somebody scanned before signing in. */
  personId: string | null;
  personName: string | null;
  jobId: string | null;
  note: string | null;
  happenedAt: string;
}

/** How much is actually there, from the movements alone.
 *
 * A count is not an adjustment, it is the truth as of that moment — so it
 * resets the running total rather than adding to it. That is the whole point
 * of counting: the shelf wins the argument.
 */
export function onHandFrom(movements: Movement[], opening = 0): number {
  let running = opening;

  for (const movement of [...movements].sort(byTime)) {
    if (movement.direction === "count") running = movement.quantity;
    else if (movement.direction === "out") running -= movement.quantity;
    else running += movement.quantity;
  }

  return running;
}

export interface Checkout {
  personId: string | null;
  personName: string | null;
  jobId: string | null;
  since: string;
  quantity: number;
}

/**
 * Who has it now, for a tool.
 *
 * Everything taken out and not brought back, newest first. A tool that is out
 * twice — two of the same saw — shows as two.
 */
export function stillOut(movements: Movement[]): Checkout[] {
  const sorted = [...movements].sort(byTime);
  let outstanding = 0;
  const open: Checkout[] = [];

  for (const movement of sorted) {
    if (movement.direction === "count") {
      // A count says what is on the shelf, which tells us nothing about who
      // is holding the rest. Anything still open stays open.
      continue;
    }

    if (movement.direction === "out") {
      outstanding += movement.quantity;
      open.push({
        personId: movement.personId,
        personName: movement.personName,
        jobId: movement.jobId,
        since: movement.happenedAt,
        quantity: movement.quantity,
      });
      continue;
    }

    // Coming back closes the oldest trips first, which is the order things
    // actually come back in.
    let returning = movement.quantity;
    outstanding = Math.max(0, outstanding - returning);
    while (returning > 0 && open.length > 0) {
      const oldest = open[0];
      if (oldest.quantity > returning) {
        oldest.quantity -= returning;
        returning = 0;
      } else {
        returning -= oldest.quantity;
        open.shift();
      }
    }
  }

  return open.reverse();
}

/** Who had it last, whether or not it is back. The question asked when
 * something turns up broken. */
export function lastTakenBy(movements: Movement[]): Movement | null {
  return [...movements].filter((m) => m.direction === "out").sort(byTime).pop() ?? null;
}

export interface UsageRun {
  /** When one was taken out. */
  startedAt: string;
  /** When the next one was — which is when the last one ran out. */
  endedAt: string;
  days: number;
  personName: string | null;
}

/**
 * How long each one lasted.
 *
 * The gap between taking one out and taking out the next is how long the
 * first one lasted. That is the toner question: nobody records "it ran out
 * today", but everybody records taking a fresh one, and the second event
 * dates the first.
 *
 * The one currently in use is not a run — it has not ended, and counting it
 * would drag every average down towards zero the moment somebody fits a new
 * one.
 */
export function runsBetweenTakeouts(movements: Movement[]): UsageRun[] {
  const takeouts = [...movements].filter((m) => m.direction === "out").sort(byTime);
  const runs: UsageRun[] = [];

  for (let i = 0; i < takeouts.length - 1; i++) {
    const started = takeouts[i];
    const ended = takeouts[i + 1];
    runs.push({
      startedAt: started.happenedAt,
      endedAt: ended.happenedAt,
      days: daysBetween(started.happenedAt, ended.happenedAt),
      personName: started.personName,
    });
  }

  return runs;
}

/** How long one of them lasts, on average. Null until two have been taken
 * out, because one takeout is not a lifespan. */
export function averageRunDays(movements: Movement[]): number | null {
  const runs = runsBetweenTakeouts(movements);
  if (runs.length === 0) return null;
  return runs.reduce((sum, run) => sum + run.days, 0) / runs.length;
}

/**
 * How much gets used in a day, from what has actually left the shelf.
 *
 * Measured across the whole span rather than per movement, so a week where
 * somebody took six bags at once does not read as a spike.
 */
export function usedPerDay(movements: Movement[]): number | null {
  const outs = [...movements].filter((m) => m.direction === "out").sort(byTime);
  if (outs.length < 2) return null;

  const span = daysBetween(outs[0].happenedAt, outs[outs.length - 1].happenedAt);
  if (span <= 0) return null;

  // The first takeout starts the clock rather than counting towards what was
  // used during it.
  const used = outs.slice(1).reduce((sum, m) => sum + m.quantity, 0);
  return used / span;
}

/** At this rate, how long what is left will last. Null when nothing is
 * moving — an honest "no idea" beats an infinity. */
export function daysOfStockLeft(movements: Movement[], onHand: number): number | null {
  const rate = usedPerDay(movements);
  if (rate == null || rate <= 0) return null;
  return onHand / rate;
}

function byTime(a: Movement, b: Movement): number {
  return a.happenedAt.localeCompare(b.happenedAt);
}

function daysBetween(from: string, to: string): number {
  const ms = new Date(to).getTime() - new Date(from).getTime();
  return ms / 86_400_000;
}
