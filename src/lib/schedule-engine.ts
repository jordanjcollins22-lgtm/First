/**
 * What the calendar would do if somebody asked it.
 *
 * The engine answers one question -- "when should this job happen, and who
 * should do it" -- and then stops. It books nothing. It moves nothing. Every
 * output is a suggestion with a date, a crew, the reasons it picked them and,
 * just as importantly, the things it does not know. A person reads it, agrees
 * or disagrees, and presses a button. Work already on the calendar stays
 * exactly where somebody put it.
 *
 * That restraint is the whole design, and it is not timidity. A scheduler that
 * silently re-arranges a week is one nobody can trust with the next week
 * either: the first time it moves a job the client had been promised, every
 * suggestion it ever makes again gets second-guessed. Recommending is a
 * smaller promise and a keepable one.
 *
 * There is no model here and no learning. Every number below is a rule
 * somebody can read, argue with and change: hours against hours, miles against
 * miles, a forecast against a threshold. When it cannot know something it says
 * so rather than filling the gap with an average -- a suggested date resting on
 * a made-up duration is worse than no suggestion, because somebody will book it.
 */

export interface SchedulableJob {
  jobId: string;
  label: string;
  /** Crew hours the job is priced at. Zero when nothing says. */
  crewHours: number;
  /** False when the services carry no timing, so the hours are not real. */
  hoursKnown: boolean;
  /** Every applicable pre-start check passing right now. */
  ready: boolean;
  /** How many blocking issues are open, for the sentence. */
  blockingIssues: number;
  lat: number | null;
  lng: number | null;
  /** The day the client picked on their proposal, when they picked one. */
  clientPreferredDate: string | null;
  /** When the work was sold, so older work is not left behind newer work. */
  soldAt: string | null;
  /** Whether rain and wind actually matter to this job. */
  weatherSensitive: boolean;
}

export interface CrewMember {
  profileId: string;
  name: string;
  /** Hours this person is free on this day, after everything already booked. */
  freeHours: number;
}

export interface DayCapacity {
  /** YYYY-MM-DD. */
  date: string;
  crew: CrewMember[];
  /** Jobs already booked that day, for the proximity rule. */
  booked: { jobId: string; lat: number | null; lng: number | null }[];
  /** True when the forecast is one a crew would not want to be out in. */
  rough: boolean;
  /** Why it is rough, in the forecast's own words. Null when it is not. */
  roughWhy: string | null;
}

export interface Suggestion {
  jobId: string;
  label: string;
  date: string;
  crewProfileIds: string[];
  crewNames: string[];
  /** Why this day and these people. Sentences, in the order they matter. */
  because: string[];
  /** What the engine could not know. Never hidden, never guessed past. */
  unknowns: string[];
  /** Higher is a better fit. Only meaningful against other suggestions. */
  score: number;
}

export interface MoveSuggestion {
  jobId: string;
  label: string;
  from: string;
  to: string | null;
  because: string[];
  unknowns: string[];
}

/** How far ahead the engine will look. Beyond this it is guessing at a season. */
export const HORIZON_DAYS = 28;

/** Two jobs closer than this are worth doing on the same day. */
export const NEIGHBOUR_MILES = 3;

/**
 * Miles between two points on the ground.
 *
 * Straight-line, which is wrong by a road-network factor that is roughly
 * constant over a county. It is used only to compare one candidate day with
 * another, so a consistent bias cancels; it is never shown as a driving
 * distance.
 */
export function milesApart(
  a: { lat: number | null; lng: number | null },
  b: { lat: number | null; lng: number | null }
): number | null {
  if (a.lat == null || a.lng == null || b.lat == null || b.lng == null) return null;
  const toRad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * toRad;
  const dLng = (b.lng - a.lng) * toRad;
  const mid = ((a.lat + b.lat) / 2) * toRad;
  const x = dLng * Math.cos(mid);
  // 3958.8 miles is the Earth's mean radius.
  return Math.sqrt(dLat * dLat + x * x) * 3958.8;
}

function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.round((b - a) / 86_400_000);
}

/**
 * The people to send, and whether there are enough of them.
 *
 * Greedy on purpose: the person with the most time free goes first, and people
 * are added until the hours are covered. A cleverer packing would win the odd
 * hour and cost the ability to explain, in one sentence, why these three.
 */
export function crewFor(day: DayCapacity, hours: number): { crew: CrewMember[]; covered: boolean } {
  const free = [...day.crew].filter((c) => c.freeHours > 0).sort((a, b) => b.freeHours - a.freeHours);
  const picked: CrewMember[] = [];
  let left = hours;
  for (const person of free) {
    if (left <= 0) break;
    picked.push(person);
    left -= person.freeHours;
  }
  return { crew: picked, covered: left <= 0 && picked.length > 0 };
}

/**
 * How well one day suits one job, and why.
 *
 * Null means the day cannot host it at all -- nobody free, or a rough forecast
 * for work the weather actually stops. Everything else is a score with its
 * reasons attached, because a number nobody can argue with is a number nobody
 * should act on.
 */
export function scoreDay(job: SchedulableJob, day: DayCapacity, today: string): Suggestion | null {
  const because: string[] = [];
  const unknowns: string[] = [];

  const hours = job.hoursKnown && job.crewHours > 0 ? job.crewHours : 8;
  if (!job.hoursKnown || job.crewHours <= 0) {
    // A day chosen on a made-up duration is worse than no suggestion, so the
    // assumption is stated rather than buried in the score.
    unknowns.push("No timing on the services, so a full day is assumed.");
  }

  const { crew, covered } = crewFor(day, hours);
  if (crew.length === 0) return null;

  // Weather only disqualifies work the weather actually stops. A patio being
  // laid and a quote being written are not the same job in the rain.
  if (day.rough && job.weatherSensitive) return null;

  let score = 0;

  if (covered) {
    score += 40;
    because.push(
      crew.length === 1
        ? `${crew[0].name} has the ${hours.toFixed(1)} hours free.`
        : `${crew.map((c) => c.name).join(" and ")} together cover the ${hours.toFixed(1)} hours.`
    );
  } else {
    const free = crew.reduce((sum, c) => sum + c.freeHours, 0);
    score += 10;
    because.push(`${free.toFixed(1)} of the ${hours.toFixed(1)} hours are free — it would run over or need a second visit.`);
  }

  // The client picked a day on their own proposal. That outranks everything
  // else the engine knows, because it is the only input here that came from
  // the person paying.
  if (job.clientPreferredDate === day.date) {
    score += 50;
    because.push("The client picked this day on their proposal.");
  } else if (job.clientPreferredDate) {
    const off = Math.abs(daysBetween(job.clientPreferredDate, day.date));
    score -= Math.min(30, off * 3);
    because.push(`The client asked for ${job.clientPreferredDate}; this is ${off} day${off === 1 ? "" : "s"} off.`);
  }

  // Another job on the same street the same day is most of a day's driving
  // saved, and it is the one saving nobody notices when it is missed.
  let nearest: number | null = null;
  for (const other of day.booked) {
    const miles = milesApart(job, other);
    if (miles != null && (nearest == null || miles < nearest)) nearest = miles;
  }
  if (nearest != null && nearest <= NEIGHBOUR_MILES) {
    score += 20;
    because.push(`Another job that day is ${nearest.toFixed(1)} miles away.`);
  }
  if (job.lat == null || job.lng == null) {
    unknowns.push("The property has no map position, so nothing was grouped by travel.");
  }

  // Sooner is better, gently: a fortnight out is not twice as bad as a week.
  const out = Math.max(0, daysBetween(today, day.date));
  score -= out * 0.5;

  if (!job.ready) {
    score -= 25;
    because.push(
      job.blockingIssues > 0
        ? `Not ready yet — ${job.blockingIssues} blocking ${job.blockingIssues === 1 ? "issue" : "issues"} open.`
        : "Not ready yet — pre-start checks are still failing."
    );
    unknowns.push("Whether it will be ready by then.");
  }

  if (day.rough) {
    score -= 10;
    because.push(`Rough forecast: ${day.roughWhy ?? "poor conditions"}. This work is not weather-sensitive.`);
  }

  return {
    jobId: job.jobId,
    label: job.label,
    date: day.date,
    crewProfileIds: crew.map((c) => c.profileId),
    crewNames: crew.map((c) => c.name),
    because,
    unknowns,
    score,
  };
}

/**
 * The best day for each job that wants one.
 *
 * One suggestion per job, never a ranked list of twelve: the question is "when
 * should this happen", and answering it with options is handing the work back.
 * Jobs are considered oldest-sold first so a busy week does not quietly push
 * the same job down every time the page is opened.
 */
export function suggestSchedule(
  jobs: readonly SchedulableJob[],
  days: readonly DayCapacity[],
  today: string
): Suggestion[] {
  const order = [...jobs].sort((a, b) => (a.soldAt ?? "").localeCompare(b.soldAt ?? ""));
  const horizon = days.filter((d) => {
    const out = daysBetween(today, d.date);
    return out >= 0 && out <= HORIZON_DAYS;
  });

  // A copy, so taking a suggestion for one job is visible to the next: two
  // jobs must not both be offered the same person's only free afternoon.
  const remaining = new Map(
    horizon.map((day) => [
      day.date,
      { ...day, crew: day.crew.map((c) => ({ ...c })), booked: [...day.booked] },
    ])
  );

  const out: Suggestion[] = [];
  for (const job of order) {
    let best: Suggestion | null = null;
    for (const day of remaining.values()) {
      const scored = scoreDay(job, day, today);
      if (scored && (best == null || scored.score > best.score)) best = scored;
    }
    if (!best) continue;
    out.push(best);

    const day = remaining.get(best.date);
    if (day) {
      let left = job.hoursKnown && job.crewHours > 0 ? job.crewHours : 8;
      for (const person of day.crew) {
        if (left <= 0) break;
        if (!best.crewProfileIds.includes(person.profileId)) continue;
        const used = Math.min(person.freeHours, left);
        person.freeHours -= used;
        left -= used;
      }
      day.booked.push({ jobId: job.jobId, lat: job.lat, lng: job.lng });
    }
  }

  return out.sort((a, b) => a.date.localeCompare(b.date) || b.score - a.score);
}

/**
 * Booked work the weather is about to spoil, and where it could go instead.
 *
 * Suggestions only, and the strongest possible statement of that: nothing in
 * this file writes to a calendar. A job whose new home cannot be found is
 * still reported, with `to` null, because "Thursday is washed out and there is
 * nowhere obvious to put these three" is exactly the thing somebody needs to
 * know on Tuesday.
 */
export function suggestMoves(
  booked: readonly { job: SchedulableJob; date: string }[],
  days: readonly DayCapacity[],
  today: string
): MoveSuggestion[] {
  const byDate = new Map(days.map((d) => [d.date, d]));
  const out: MoveSuggestion[] = [];

  for (const { job, date } of booked) {
    const day = byDate.get(date);
    if (!day?.rough || !job.weatherSensitive) continue;

    const alternatives = days
      .filter((d) => daysBetween(today, d.date) >= 0 && d.date !== date && !d.rough)
      .map((d) => scoreDay(job, d, today))
      .filter((s): s is Suggestion => s != null)
      .sort((a, b) => b.score - a.score);

    const best = alternatives[0] ?? null;
    out.push({
      jobId: job.jobId,
      label: job.label,
      from: date,
      to: best?.date ?? null,
      because: best
        ? [`${date} is rough: ${day.roughWhy ?? "poor conditions"}.`, ...best.because]
        : [`${date} is rough: ${day.roughWhy ?? "poor conditions"}.`, "Nothing in the next four weeks has the room."],
      unknowns: best?.unknowns ?? ["Where it could go instead."],
    });
  }

  return out;
}
