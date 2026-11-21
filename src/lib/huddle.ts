/**
 * The morning team huddle: ten minutes, the same five steps every morning.
 *
 *   1. The number (1 min)       what today has to add up to
 *   2. Crew by crew (5 min)     each lead reads their stops and says what they need
 *   3. Watch-outs (2 min)       what could go wrong today
 *   4. Blockers (1 min)         written down, fixed right after, never during
 *   5. One shout-out (1 min)    one technician, one specific thing
 *
 * Then roll. Everything here is plain data so the page, the copy-to-text
 * button and the tests all read the same thing.
 */

export interface HuddleStop {
  /** The job, when the stop is a job in the app. Opens its no-login crew page. */
  jobId: string | null;
  client: string;
  address: string;
  /** "10 AM", "ETA 11 AM", or empty. */
  time: string;
  /** What the crew is doing there, in a sentence. */
  work: string;
}

export interface HuddleCrew {
  /** "Harrison's crew". Crews are trucks. */
  name: string;
  /** Where and when they meet, or who they follow. Optional. */
  meet: string;
  stops: HuddleStop[];
}

export interface Huddle {
  day: string;
  goal: string;
  crews: HuddleCrew[];
  watchOuts: string;
  blockers: string;
  shoutOut: string;
  /** Where the crews came from: the day's saved plan, or the app's schedule. */
  source: "plan" | "schedule" | "empty";
}

export const HUDDLE_STEPS = [
  { key: "number", title: "The number", minutes: 1, prompt: "Say today's number out loud and ask: can we hit it?" },
  { key: "crews", title: "Crew by crew", minutes: 5, prompt: "Each lead reads their stops off their crew text and says what they need that they don't have yet." },
  { key: "watch", title: "Watch-outs", minutes: 2, prompt: "Weather, tight access, utilities, client asks, tools or material that has to be loaded." },
  { key: "blockers", title: "Blockers", minutes: 1, prompt: "Write them down only. They get fixed right after the team huddle, not during it." },
  { key: "shout", title: "One shout-out", minutes: 1, prompt: "Name one technician and the specific thing they did well." },
] as const;

export const HUDDLE_MINUTES = HUDDLE_STEPS.reduce((n, s) => n + s.minutes, 0);

/** "Harrison" -> "Harrison's crew". A name already ending in s keeps one apostrophe. */
export function crewName(lead: string): string {
  const first = lead.trim().split(/\s+/)[0] ?? "";
  if (!first) return "Unassigned";
  const cap = first[0].toUpperCase() + first.slice(1);
  return /s$/i.test(cap) ? `${cap}' crew` : `${cap}'s crew`;
}

/** Different jobs on the day. Two crews on the same wall is one stop, not two. */
export function stopCount(crews: HuddleCrew[]): number {
  const seen = new Set<string>();
  for (const c of crews) for (const s of c.stops) seen.add(s.jobId ?? `${s.client}|${s.address}`);
  return seen.size;
}

/** The number when nobody has set one: every stop finished and photographed. */
export function defaultGoal(crews: HuddleCrew[]): string {
  const stops = stopCount(crews);
  const working = crews.filter((c) => c.stops.length || c.meet).length;
  if (!stops) return "Nothing on the schedule yet.";
  return `${working} ${working === 1 ? "crew" : "crews"}, ${stops} ${stops === 1 ? "stop" : "stops"}. Every job finished and photographed before anyone leaves the site.`;
}

export interface ScheduleRow {
  jobId: string;
  client: string;
  address: string;
  purpose: string | null;
  stopOrder: number | null;
  /** The crew lead's name, or null when nobody is on the job. */
  lead: string | null;
}

/**
 * Crews built from the app's schedule when no plan was saved for the day:
 * one crew per lead, stops in the office's order.
 */
export function crewsFromSchedule(rows: ScheduleRow[]): HuddleCrew[] {
  const byCrew = new Map<string, ScheduleRow[]>();
  for (const r of rows) {
    const k = r.lead ? crewName(r.lead) : "Unassigned";
    byCrew.set(k, [...(byCrew.get(k) ?? []), r]);
  }
  return [...byCrew.entries()]
    .sort(([a], [b]) => (a === "Unassigned" ? 1 : b === "Unassigned" ? -1 : a.localeCompare(b)))
    .map(([name, list]) => ({
      name,
      meet: "",
      stops: list
        .sort((a, b) => (a.stopOrder ?? Number.MAX_SAFE_INTEGER) - (b.stopOrder ?? Number.MAX_SAFE_INTEGER) || a.jobId.localeCompare(b.jobId))
        .map((r) => ({ jobId: r.jobId, client: r.client, address: r.address, time: "", work: r.purpose ?? "" })),
    }));
}

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

/** A saved plan's crews, read defensively: it is hand-written JSON. */
export function readCrews(raw: unknown): HuddleCrew[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((c): c is Record<string, unknown> => !!c && typeof c === "object")
    .map((c) => ({
      name: str(c.name) || "Crew",
      meet: str(c.meet),
      stops: (Array.isArray(c.stops) ? c.stops : [])
        .filter((s): s is Record<string, unknown> => !!s && typeof s === "object")
        .map((s) => {
          const id = str(s.jobId ?? s.job_id);
          return {
            jobId: /^[0-9a-f-]{36}$/i.test(id) ? id.toLowerCase() : null,
            client: str(s.client) || "Client",
            address: str(s.address),
            time: str(s.time),
            work: str(s.work),
          };
        }),
    }));
}

/** The whole huddle as one plain text, for the team group text. */
export function huddleText(h: Huddle, origin = "https://app.jslandscapingmd.com"): string {
  const lines: string[] = [`Team huddle, ${h.day}`, "", `1. The number: ${h.goal}`, "", "2. Crew by crew"];
  for (const c of h.crews) {
    lines.push(`${c.name}${c.meet ? `: ${c.meet}` : ""}`);
    c.stops.forEach((s, i) => {
      lines.push(`  ${i + 1}. ${s.client}${s.time ? `, ${s.time}` : ""}${s.work ? `: ${s.work}` : ""}`);
      if (s.jobId) lines.push(`     ${origin}/crew/${s.jobId}`);
    });
  }
  lines.push("", `3. Watch-outs: ${h.watchOuts || "none called out"}`);
  lines.push(`4. Blockers (fixed after the huddle): ${h.blockers || "none"}`);
  lines.push(`5. Shout-out: ${h.shoutOut || "pick one technician"}`);
  lines.push("", "Then roll.");
  return lines.join("\n");
}
