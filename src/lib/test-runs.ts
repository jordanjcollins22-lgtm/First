/**
 * Test runs of the booking funnel: somebody given a ?test=1 link goes
 * through booking, the map and the estimate as a client would, with nothing
 * charged or booked. This works out, for each run, how far they got and
 * what they asked for, for the admin Test runs page.
 *
 * Pure, so it is tested without a database.
 */

import { choiceLabel, dollars, hereLabel, wantLabels, type TapSpot } from "@/lib/tap-estimate";
import { readSizing } from "@/lib/spot-size-words";

/** The steps of a run, in order. */
export const RUN_STAGES = ["Gave their details", "Opened the map", "Got an estimate", "Chose how to pay", "Picked a day"] as const;

export interface RunInput {
  jobId: string;
  jobNumber: number | null;
  createdAt: string;
  customer: { name: string | null; email: string | null; phone: string | null };
  address: string | null;
  /** The intake token, for opening the client's own pages. */
  token: string | null;
  photoFlag: "outdated" | "wrong_property" | null;
  estimate: {
    spots: TapSpot[];
    sizing: unknown;
    totalCents: number;
    depositCents: number;
    choice: "deposit" | "evaluation" | null;
    tierName: string | null;
    chargedCents: number | null;
    startDay: string | null;
    testVisitAt: string | null;
    createdAt: string;
    updatedAt: string | null;
  } | null;
  /** Funnel steps recorded for the job, with when. */
  steps: { step: string; at: string }[];
}

export interface RunSpot {
  number: number;
  /** "Dirt or weeds → A mulch bed", or the priced choices for a spot from before the two questions. */
  asked: string;
  /** "About 240 sq ft" style, when it was sized. */
  size: string | null;
  /** How the size was reached, in a few words. */
  sizedBy: string | null;
  priceCents: number | null;
}

export interface TestRun {
  jobId: string;
  jobNumber: number | null;
  startedAt: string;
  lastAt: string;
  /** Start to last thing they did, in minutes. */
  minutes: number;
  name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  token: string | null;
  /** 1 to RUN_STAGES.length. */
  stage: number;
  stageLabel: string;
  spots: RunSpot[];
  totalCents: number | null;
  depositCents: number | null;
  /** "Deposit, $367" or "Measured plan, $199". Null before they chose. */
  chose: string | null;
  /** "Start Wednesday, Nov 4" or "Evaluation Wednesday, Nov 4, 10:00 AM". */
  picked: string | null;
  photoFlag: "outdated" | "wrong_property" | null;
}

const SIZED_BY: Record<string, string> = { traced: "traced by them", ai: "AI from photo", history: "your past jobs", typical: "typical guess" };

function dayWords(isoDay: string): string {
  const d = new Date(`${isoDay}T12:00:00Z`);
  return d.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric", timeZone: "UTC" });
}

function timeWords(iso: string, timeZone: string): string {
  return new Date(iso).toLocaleString("en-US", { weekday: "long", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone });
}

/** One spot as the page lists it. */
export function describeSpot(spot: TapSpot, index: number, sizing: ReturnType<typeof readSizing>): RunSpot {
  const here = hereLabel(spot.here);
  const wants = wantLabels(spot.here, spot.wants);
  const asked = here ? (wants.length ? `${here} → ${wants.join(", ")}` : here) : spot.choices.map(choiceLabel).join(", ");
  const size = sizing.find((s) => s.index === index) ?? null;
  const amount = size
    ? size.areaSqft != null
      ? `About ${Math.round(size.areaSqft).toLocaleString("en-US")} sq ft`
      : size.count != null
        ? `${size.count} ${size.count === 1 ? "plant or shrub" : "plants or shrubs"}`
        : null
    : null;
  return {
    number: index + 1,
    asked,
    size: amount,
    sizedBy: size ? (SIZED_BY[size.source] ?? size.source) : null,
    priceCents: size?.priceCents ?? null,
  };
}

/** A run, worked out from what was saved along the way. */
export function summarizeRun(run: RunInput, timeZone = "America/New_York"): TestRun {
  const e = run.estimate;
  const mapOpened = run.steps.some((s) => s.step === "map_opened" || s.step === "map_tapped");
  const picked = e ? Boolean(e.startDay || e.testVisitAt) : false;
  const stage = picked ? 5 : e?.choice ? 4 : e ? 3 : mapOpened ? 2 : 1;

  const times = [run.createdAt, ...run.steps.map((s) => s.at), ...(e ? [e.createdAt, e.updatedAt ?? e.createdAt] : [])].filter(Boolean);
  const lastAt = times.reduce((a, b) => (b > a ? b : a), run.createdAt);
  const minutes = Math.max(0, (Date.parse(lastAt) - Date.parse(run.createdAt)) / 60_000);

  const sizing = e ? readSizing(e.sizing) : [];
  const chose =
    e?.choice === "deposit"
      ? `Deposit, ${dollars(e.chargedCents ?? e.depositCents)}`
      : e?.choice === "evaluation"
        ? `${e.tierName ?? "Evaluation"}${e.chargedCents != null ? `, ${dollars(e.chargedCents)}` : ""}`
        : null;
  const pickedWords = e?.startDay
    ? `Start ${dayWords(e.startDay)}`
    : e?.testVisitAt
      ? `Evaluation ${timeWords(e.testVisitAt, timeZone)}`
      : null;

  return {
    jobId: run.jobId,
    jobNumber: run.jobNumber,
    startedAt: run.createdAt,
    lastAt,
    minutes,
    name: run.customer.name?.trim() || "No name",
    email: run.customer.email,
    phone: run.customer.phone,
    address: run.address,
    token: run.token,
    stage,
    stageLabel: RUN_STAGES[stage - 1],
    spots: e ? e.spots.map((s, i) => describeSpot(s, i, sizing)) : [],
    totalCents: e ? e.totalCents : null,
    depositCents: e ? e.depositCents : null,
    chose,
    picked: pickedWords,
    photoFlag: run.photoFlag,
  };
}
