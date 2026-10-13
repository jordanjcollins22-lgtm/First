/**
 * The rain-delay rules, and the cascade that follows from them.
 *
 * Pure: no database, no clock, no network. The cron gathers the forecast and
 * the calendar, this decides what moves, and the cron applies it. Keeping
 * the decision here is what lets every rule be tested with a made-up week,
 * and what lets the office read exactly why a day was moved.
 *
 * Two ideas carry the whole file.
 *
 * **A rule per kind of work.** Mowing wet grass tears it and ruts the lawn;
 * laying a patio in the rain ruins the base; neither should go out the day
 * after two inches of rain either, because the ground is still soft. Salting
 * and plowing are the opposite: the weather is the reason to go. Anything
 * else (a walkthrough, a cleanup) is left alone, because a schedule that
 * moves work the weather does not stop is one people stop trusting.
 *
 * **A crew's days move as a chain.** When Monday is rained out, Monday's
 * work goes to the next workable day, and whatever that crew had on that day
 * goes to the one after, and so on until the chain finds a gap. That is what
 * an office does by hand with a whiteboard, and it is the thing nobody wants
 * to do at six in the morning.
 */

export type WorkType = "mowing" | "install" | "snow" | "other";

export const WORK_TYPE_LABEL: Record<WorkType, string> = {
  mowing: "Mowing",
  install: "Install",
  snow: "Snow and salt",
  other: "Other",
};

/** Services that weather stops the way it stops a patio: the ground matters. */
const INSTALL_WORDS = ["grading", "hardscape", "patio", "paver", "planting", "sod", "seeding", "seed", "mulch", "drainage", "install", "wall", "aeration"];
const MOW_WORDS = ["mow", "trim", "edging"];
const SNOW_WORDS = ["salt", "snow", "plow", "plough", "ice"];

/**
 * Whole words only, matched from the front: "salting" is salt, "service" is
 * not ice. Service ids are slugs like "lawn-mowing" or "paver_patio".
 */
const has = (id: string, words: string[]) => {
  const tokens = id.split(/[^a-z0-9]+/).filter(Boolean);
  return words.some((w) => tokens.some((t) => t.startsWith(w)));
};

/**
 * What kind of work a visit is, from its job's requested services.
 *
 * Install outranks mowing outranks snow when a job carries several, because
 * the strictest rule should win: a job with a patio and a mow on it should
 * not go out the day the patio cannot.
 */
export function workTypeFor(serviceIds: readonly string[], hints: { mowOrder?: boolean; saltOrder?: boolean } = {}): WorkType {
  const ids = serviceIds.map((s) => s.toLowerCase());
  if (ids.some((id) => has(id, INSTALL_WORDS))) return "install";
  if (hints.mowOrder || ids.some((id) => has(id, MOW_WORDS))) return "mowing";
  if (hints.saltOrder || (ids.length > 0 && ids.every((id) => has(id, SNOW_WORDS)))) return "snow";
  return "other";
}

/** One day's weather at one place, in the units the rules are written in. */
export interface DayWeather {
  /** YYYY-MM-DD, in the place's own time zone. */
  date: string;
  /** Inches of rain expected (or that fell, for a past day). */
  rainIn: number;
  /** Chance of any precipitation, 0-100. A past day is 100 if it rained. */
  rainChance: number;
  /** Inches of snow expected. */
  snowIn: number;
  /** WMO weather code. */
  code: number;
  tempMinF: number;
  tempMaxF: number;
}

export interface RainRules {
  /** Rain on the day, in inches, at or over which mowing does not go out. */
  mowRainIn: number;
  /** The same for installs, which are fussier: a wet base is a ruined base. */
  installRainIn: number;
  /** Below this chance the rain is not counted, however much is forecast. */
  rainChanceMin: number;
  /** Rain that leaves the ground too soft for the days after it. */
  heavyRainIn: number;
  /** How many days after heavy rain the ground counts as saturated. */
  saturatedDays: number;
  /** Snow that stops ground work on the day. */
  snowBlocksIn: number;
}

export const DEFAULT_RAIN_RULES: RainRules = {
  mowRainIn: 0.25,
  installRainIn: 0.2,
  rainChanceMin: 50,
  heavyRainIn: 1,
  saturatedDays: 1,
  snowBlocksIn: 0.5,
};

/** Read off the settings row, with the defaults behind anything unset or nonsense. */
export function rainRulesFrom(row: Record<string, unknown> | null | undefined): RainRules {
  const num = (key: string, fallback: number, min = 0) => {
    const v = Number(row?.[key]);
    return Number.isFinite(v) && v >= min ? v : fallback;
  };
  return {
    mowRainIn: num("mow_rain_in", DEFAULT_RAIN_RULES.mowRainIn, 0.01),
    installRainIn: num("install_rain_in", DEFAULT_RAIN_RULES.installRainIn, 0.01),
    rainChanceMin: num("rain_chance_min", DEFAULT_RAIN_RULES.rainChanceMin),
    heavyRainIn: num("heavy_rain_in", DEFAULT_RAIN_RULES.heavyRainIn, 0.01),
    saturatedDays: Math.min(3, Math.round(num("saturated_days", DEFAULT_RAIN_RULES.saturatedDays))),
    snowBlocksIn: num("snow_blocks_in", DEFAULT_RAIN_RULES.snowBlocksIn, 0.01),
  };
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000);
}

export function weekdayOf(date: string): number {
  return new Date(`${date}T12:00:00Z`).getUTCDay();
}

const WEEKDAY = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const inches = (n: number) => `${Math.round(n * 100) / 100} in`;

/**
 * Why this kind of work cannot go out on this day, or null when it can.
 *
 * A day with no forecast is workable: beyond the forecast nobody knows, and
 * moving work on a guess is worse than leaving it. The reason is a sentence,
 * because it is shown to the office and, cut down, to the client.
 */
export function blockReason(
  type: WorkType,
  date: string,
  weather: ReadonlyMap<string, DayWeather>,
  rules: RainRules = DEFAULT_RAIN_RULES
): string | null {
  if (type !== "mowing" && type !== "install") return null;
  const day = weather.get(date);

  if (day) {
    if (day.snowIn >= rules.snowBlocksIn) return `${inches(day.snowIn)} of snow forecast`;
    const limit = type === "mowing" ? rules.mowRainIn : rules.installRainIn;
    const likely = day.rainChance >= rules.rainChanceMin;
    if (likely && day.rainIn >= limit) return `${inches(day.rainIn)} of rain forecast (${Math.round(day.rainChance)}% chance)`;
    if (likely && day.code >= 95) return `thunderstorms forecast (${Math.round(day.rainChance)}% chance)`;
  }

  // The ground after heavy rain. Checked even with no forecast for the day
  // itself, because yesterday's downpour is known whatever tomorrow does.
  for (let back = 1; back <= rules.saturatedDays; back += 1) {
    const before = weather.get(addDays(date, -back));
    if (before && before.rainChance >= rules.rainChanceMin && before.rainIn >= rules.heavyRainIn) {
      return `ground still saturated after ${inches(before.rainIn)} of rain on ${WEEKDAY[weekdayOf(before.date)]}`;
    }
  }
  return null;
}

/* -------------------------------------------------------------------------
 * The cascade
 * ---------------------------------------------------------------------- */

export interface CascadeSession {
  id: string;
  jobId: string;
  /** The crew whose days these are: the lead, the subcontractor, or the job alone. */
  chainKey: string;
  startsOn: string;
  endsOn: string;
  workType: WorkType;
  /** Which forecast applies. Null uses no forecast (always workable). */
  locationKey: string | null;
  /**
   * False for a visit the cascade must not touch: under way, created before
   * the switch was turned on, or anything else the office owns. It stays put
   * and its days are kept clear of moved work.
   */
  movable: boolean;
}

export interface CascadeInput {
  sessions: readonly CascadeSession[];
  weatherByLocation: ReadonlyMap<string, ReadonlyMap<string, DayWeather>>;
  rules: RainRules;
  /** Weekdays a moved day may land on, 0 = Sunday. */
  workWeekdays: readonly number[];
  /** Nothing before this date is moved or moved onto. */
  today: string;
  /** How far past its own date a visit may be pushed before giving up. */
  maxSearchDays?: number;
}

export interface PlannedMove {
  sessionId: string;
  jobId: string;
  chainKey: string;
  workType: WorkType;
  fromStart: string;
  fromEnd: string;
  toStart: string;
  toEnd: string;
  cause: "weather" | "chain";
  reason: string;
  shiftDays: number;
}

export interface StuckVisit {
  sessionId: string;
  jobId: string;
  chainKey: string;
  reason: string;
}

export interface CascadePlan {
  moves: PlannedMove[];
  stuck: StuckVisit[];
}

const NO_WEATHER: ReadonlyMap<string, DayWeather> = new Map();

function spanDays(start: string, end: string): string[] {
  const out: string[] = [];
  const n = Math.max(0, daysBetween(start, end));
  for (let i = 0; i <= n; i += 1) out.push(addDays(start, i));
  return out;
}

/** A crew's day of work: every visit sharing the same dates moves together. */
interface Unit {
  start: string;
  end: string;
  sessions: CascadeSession[];
}

function unitBlock(unit: Unit, start: string, input: CascadeInput): string | null {
  const length = daysBetween(unit.start, unit.end);
  for (const day of spanDays(start, addDays(start, length))) {
    for (const s of unit.sessions) {
      const weather = s.locationKey ? input.weatherByLocation.get(s.locationKey) ?? NO_WEATHER : NO_WEATHER;
      const why = blockReason(s.workType, day, weather, input.rules);
      if (why) return day === start && length === 0 ? why : `${why} (${WEEKDAY[weekdayOf(day)]})`;
    }
  }
  return null;
}

/**
 * Which visits move where.
 *
 * Per crew, in date order. A day the weather breaks the rule for moves to the
 * next day that is a work day, has workable weather for every visit on it,
 * and is not already taken by a visit that has to stay. A day that a moved
 * day lands on is pushed along in turn. A day nothing lands on stays exactly
 * where it is, so the chain stops at the first gap.
 */
export function planCascade(input: CascadeInput): CascadePlan {
  const maxSearch = input.maxSearchDays ?? 21;
  const workdays = new Set(input.workWeekdays.length > 0 ? input.workWeekdays : [1, 2, 3, 4, 5]);
  const moves: PlannedMove[] = [];
  const stuck: StuckVisit[] = [];

  const chains = new Map<string, CascadeSession[]>();
  for (const s of input.sessions) {
    if (s.endsOn < input.today) continue;
    const list = chains.get(s.chainKey) ?? [];
    list.push(s);
    chains.set(s.chainKey, list);
  }

  for (const [chainKey, sessions] of chains) {
    // Days kept by visits that cannot move.
    const fixed = new Set<string>();
    for (const s of sessions) if (!s.movable) for (const d of spanDays(s.startsOn, s.endsOn)) fixed.add(d);

    const units = new Map<string, Unit>();
    for (const s of sessions) {
      if (!s.movable) continue;
      const key = `${s.startsOn}|${s.endsOn}`;
      const unit = units.get(key) ?? { start: s.startsOn, end: s.endsOn, sessions: [] };
      unit.sessions.push(s);
      units.set(key, unit);
    }
    const ordered = [...units.values()].sort((a, b) => (a.start === b.start ? a.end.localeCompare(b.end) : a.start.localeCompare(b.start)));

    // Days taken by work that has been placed, moved or not.
    const placed = new Set<string>();
    // Days taken by work that moved: the only thing that pushes a day that
    // the weather has not touched.
    const movedInto = new Set<string>();
    // What pushed the chain, for the sentence on a day moved only by it.
    let pushedBy: string | null = null;

    for (const unit of ordered) {
      // Already started: it stays, and only claims its days.
      if (unit.start < input.today) {
        for (const d of spanDays(unit.start, unit.end)) placed.add(d);
        continue;
      }
      const length = daysBetween(unit.start, unit.end);
      const weatherWhy = unitBlock(unit, unit.start, input);
      const collides = spanDays(unit.start, unit.end).some((d) => movedInto.has(d));
      if (!weatherWhy && !collides) {
        for (const d of spanDays(unit.start, unit.end)) placed.add(d);
        continue;
      }

      let landed: string | null = null;
      for (let step = 1; step <= maxSearch; step += 1) {
        const candidate = addDays(unit.start, step);
        if (!workdays.has(weekdayOf(candidate))) continue;
        const days = spanDays(candidate, addDays(candidate, length));
        if (days.some((d) => fixed.has(d) || placed.has(d))) continue;
        if (unitBlock(unit, candidate, input)) continue;
        landed = candidate;
        break;
      }

      if (!landed) {
        for (const s of unit.sessions) {
          stuck.push({
            sessionId: s.id,
            jobId: s.jobId,
            chainKey,
            reason: `No workable day in the next ${maxSearch} days${weatherWhy ? ` (${weatherWhy})` : ""}.`,
          });
        }
        // It keeps its days, so nothing else lands on them.
        for (const d of spanDays(unit.start, unit.end)) placed.add(d);
        continue;
      }

      const toEnd = addDays(landed, length);
      for (const d of spanDays(landed, toEnd)) {
        placed.add(d);
        movedInto.add(d);
      }
      if (weatherWhy) pushedBy = `${WEEKDAY[weekdayOf(unit.start)]}'s work moved for weather`;
      for (const s of unit.sessions) {
        moves.push({
          sessionId: s.id,
          jobId: s.jobId,
          chainKey,
          workType: s.workType,
          fromStart: s.startsOn,
          fromEnd: s.endsOn,
          toStart: landed,
          toEnd,
          cause: weatherWhy ? "weather" : "chain",
          reason: weatherWhy ?? `${pushedBy ?? "The day before it moved"}, so the crew's next day moved along`,
          shiftDays: daysBetween(s.startsOn, landed),
        });
      }
    }
  }

  return { moves, stuck };
}

export interface AutoApplyLimits {
  autoApply: boolean;
  maxShiftDays: number;
  maxMoves: number;
}

/**
 * Whether a crew's chain of moves can be made without asking.
 *
 * All or nothing per chain: half a chain applied leaves two visits on one
 * day. Returns the reason it needs a person, or null when it does not.
 */
export function needsApproval(chainMoves: readonly PlannedMove[], limits: AutoApplyLimits, movesSoFar = 0): string | null {
  if (!limits.autoApply) return "Moving work automatically is switched off.";
  const furthest = Math.max(0, ...chainMoves.map((m) => m.shiftDays));
  if (furthest > limits.maxShiftDays) return `One visit would move ${furthest} days, more than the ${limits.maxShiftDays} allowed without asking.`;
  if (movesSoFar + chainMoves.length > limits.maxMoves) return `More than ${limits.maxMoves} visits would move in one run.`;
  return null;
}

/**
 * The order to write moves in so no two visits of one crew ever share a day
 * on the way: latest first, so each day is vacated before something moves in.
 */
export function applyOrder<T extends { toStart: string; fromStart: string }>(moves: readonly T[]): T[] {
  return [...moves].sort((a, b) => b.toStart.localeCompare(a.toStart) || b.fromStart.localeCompare(a.fromStart));
}

/** What the client is told, short enough for a text. */
export function clientNotice(input: { firstName: string | null; business: string; fromStart: string; toStart: string; cause: "weather" | "chain" }): string {
  const hi = input.firstName ? `Hi ${input.firstName}, ` : "Hi, ";
  const from = longDay(input.fromStart);
  const to = longDay(input.toStart);
  const why = input.cause === "weather" ? "because of the weather forecast" : "because the rain pushed our schedule back a day";
  return `${hi}this is ${input.business}. We've moved your visit from ${from} to ${to} ${why}. Nothing for you to do. Reply here if ${to} doesn't work.`;
}

export function longDay(date: string): string {
  const d = new Date(`${date}T12:00:00Z`);
  return d.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric", timeZone: "UTC" });
}

/** The key that keeps a client from hearing about one move twice. */
export function rescheduleDedupeKey(sessionId: string, fromStart: string, toStart: string, channel: string): string {
  return `weather_reschedule:${sessionId}:${fromStart}:${toStart}:${channel}`;
}
