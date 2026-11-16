import type { Position } from "@/lib/hiring/positions";

/**
 * An application, checked. Pure, so the rules that decide who is asked for a
 * video are tested without a database.
 */

export type Answers = Record<string, string>;

export interface Contact {
  name: string;
  email: string;
  phone: string;
  zip: string;
}

const MAX_TEXT = 1500;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Only the position's own questions, each a known answer or trimmed text. Anything else sent is dropped. */
export function cleanAnswers(position: Position, raw: unknown): Answers {
  const input = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const out: Answers = {};
  for (const q of position.questions) {
    const value = input[q.key];
    if (typeof value !== "string") continue;
    const v = value.trim();
    if (!v) continue;
    if (q.kind === "yesno") {
      if (v === "yes" || v === "no") out[q.key] = v;
    } else if (q.kind === "choice") {
      if (q.options?.includes(v)) out[q.key] = v;
    } else {
      out[q.key] = v.slice(0, MAX_TEXT);
    }
  }
  return out;
}

export function cleanContact(raw: unknown): Contact {
  const input = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const text = (key: string, max: number) => (typeof input[key] === "string" ? (input[key] as string).trim().slice(0, max) : "");
  return { name: text("name", 120), email: text("email", 200).toLowerCase(), phone: text("phone", 40), zip: text("zip", 10) };
}

/** What is missing before it can be sent, in the applicant's words. Empty when it is complete. */
export function missing(position: Position, contact: Contact, answers: Answers): string[] {
  const out: string[] = [];
  if (contact.name.length < 2) out.push("Your name");
  if (!EMAIL.test(contact.email)) out.push("An email address we can reach you at");
  // Indeed's relay address only reaches them inside Indeed; we write to them directly.
  else if (/@indeedemail\.com$/i.test(contact.email)) out.push("Your personal email, not your Indeed address");
  if (contact.phone.replace(/\D/g, "").length < 10) out.push("A phone number with area code");
  if (!/^\d{5}$/.test(contact.zip)) out.push("Your 5-digit ZIP code");
  for (const q of position.questions) {
    if (!q.optional && !answers[q.key]) out.push(q.label);
  }
  return out;
}

export interface Screened {
  passed: boolean;
  /** Each knockout that was not passed, in our words. Seen by us only. */
  reasons: string[];
}

/** Every knockout question answered with a passing answer. */
export function screen(position: Position, answers: Answers): Screened {
  const reasons: string[] = [];
  for (const q of position.questions) {
    if (!q.passes) continue;
    if (!q.passes.includes(answers[q.key] ?? "")) reasons.push(q.failReason ?? q.label);
  }
  return { passed: reasons.length === 0, reasons };
}

/** The stages an application moves through, in order, with what each is called on screen. */
export const STAGES = {
  screened_out: "Didn't pass the questions",
  video_requested: "Waiting for their video",
  video_submitted: "Video to review",
  interview: "Invited to interview",
  working_interview: "Working interview",
  owner_talk: "Owner talk",
  offer_sent: "Offer sent",
  hired: "Hired",
  not_a_fit: "Not a fit",
  withdrawn: "Withdrew",
} as const;

export type Stage = keyof typeof STAGES;

/**
 * A stage's name for one job. The skills step is a paid half-day working
 * interview on a crew, but an affiliate never works on a crew, so theirs is a
 * practice round: answer a few real posts in the app while we watch.
 */
export function stageLabel(stage: Stage, position: string | null | undefined): string {
  if (stage === "working_interview" && position === "affiliate") return "Practice round";
  return STAGES[stage];
}

/** What happens at the skills step, for the person running it. */
export function skillsStepFor(position: string | null | undefined): string {
  if (position === "affiliate") {
    return "Practice round: sit with them while they answer three real posts on Posts to Answer, start to finish, using the tutorial. Look for posts picked well, friendly wording, and the link added.";
  }
  if (position === "account-manager") {
    return "Working interview: a paid half-day running the front desk and next week's schedule with you. Look for clear, kind replies and nothing missed.";
  }
  return "Working interview: a paid half-day on a real crew. Look for showing up on time, keeping pace, and leaving the site clean.";
}

export function isStage(value: string): value is Stage {
  return value in STAGES;
}

/**
 * Where an application can go from where it is. The two ends are the person's
 * call, not the form's. The middle follows the hiring steps: first interview,
 * a paid half-day working interview (a practice round for an affiliate), the
 * owner talk, then the offer. Going from the first interview straight to the
 * owner talk is still allowed, for someone the owner already knows.
 */
export function nextStages(stage: Stage): Stage[] {
  switch (stage) {
    case "video_submitted":
      return ["interview", "not_a_fit"];
    case "interview":
      return ["working_interview", "owner_talk", "not_a_fit", "withdrawn"];
    case "working_interview":
      return ["owner_talk", "not_a_fit", "withdrawn"];
    case "owner_talk":
      return ["offer_sent", "not_a_fit", "withdrawn"];
    case "offer_sent":
      // Their yes is the hire; a no is theirs to give.
      return ["hired", "withdrawn"];
    case "video_requested":
      return ["not_a_fit", "withdrawn"];
    case "screened_out":
      // A knockout answered wrong by mistake: let them record a video after all.
      return ["video_requested"];
    default:
      return [];
  }
}
