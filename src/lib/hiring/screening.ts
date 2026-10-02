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
  hired: "Hired",
  not_a_fit: "Not a fit",
  withdrawn: "Withdrew",
} as const;

export type Stage = keyof typeof STAGES;

export function isStage(value: string): value is Stage {
  return value in STAGES;
}

/** Where an application can go from where it is. The two ends are the person's call, not the form's. */
export function nextStages(stage: Stage): Stage[] {
  switch (stage) {
    case "video_submitted":
      return ["interview", "not_a_fit"];
    case "interview":
      return ["hired", "not_a_fit"];
    case "video_requested":
      return ["not_a_fit", "withdrawn"];
    case "screened_out":
      // A knockout answered wrong by mistake: let them record a video after all.
      return ["video_requested"];
    default:
      return [];
  }
}
