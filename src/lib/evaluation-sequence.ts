/**
 * The emails a client gets around a booked evaluation.
 *
 * Five of them, in order: straight after booking, two days before, the
 * evening before, the morning of, and the evening after. The wording is
 * data, editable per business; what is code here is the shape of a step,
 * the placeholders a template may use, and the same brace-filling the
 * database does, so the settings screen can show a preview that matches
 * what will actually go out.
 *
 * Nothing here sends and nothing here decides what is due. The database
 * does both: evaluation_sequence_due() in migration 0252 is the timing
 * and the safety rules, and the scheduled sender only carries what it
 * returns.
 */

export const STEP_KEYS = ["booked", "two_days", "day_before", "morning_of", "after"] as const;
export type SequenceStepKey = (typeof STEP_KEYS)[number];

export function isSequenceStep(value: unknown): value is SequenceStepKey {
  return typeof value === "string" && (STEP_KEYS as readonly string[]).includes(value);
}

export interface SequenceStep {
  step: SequenceStepKey;
  ordinal: number;
  label: string;
  /** When it goes, in the office's words. */
  timing: string;
  enabled: boolean;
  subject: string;
  body: string;
  /** True when this business has changed the wording from the default. */
  custom: boolean;
  updatedAt: string | null;
}

/** What the braces in a template may hold, and what each becomes. */
export const PLACEHOLDERS: { key: string; means: string }[] = [
  { key: "first_name", means: "The client's first name" },
  { key: "when", means: "Day, date and time, like Thursday, September 17 at 9:00 am" },
  { key: "day", means: "The weekday, like Thursday" },
  { key: "date", means: "The date, like September 17" },
  { key: "time", means: "The time, like 9:00 am" },
  { key: "address", means: "The property, street and town" },
  { key: "evaluator", means: "First name of whoever is assigned, or the business contact" },
  { key: "business", means: "The business name" },
  { key: "phone", means: "The business phone" },
  { key: "website", means: "The business website" },
];

const KNOWN = new Set(PLACEHOLDERS.map((p) => p.key));

/** Fill the braces in. The same replacement the database does. */
export function renderTemplate(template: string, vars: Record<string, string>): string {
  let out = template ?? "";
  for (const [key, value] of Object.entries(vars)) {
    out = out.split(`{${key}}`).join(value ?? "");
  }
  return out;
}

/** Braces the database will not fill, so a typo is caught before it is sent. */
export function unknownPlaceholders(text: string): string[] {
  const found = new Set<string>();
  for (const match of text.matchAll(/\{([a-z_]+)\}/g)) {
    if (!KNOWN.has(match[1])) found.add(match[1]);
  }
  return [...found];
}

/** A client to preview the wording with. Nobody real. */
export const SAMPLE_VARS: Record<string, string> = {
  first_name: "Deanna",
  when: "Thursday, September 17 at 9:00 am",
  day: "Thursday",
  date: "September 17",
  time: "9:00 am",
  address: "1613 Bimini Drive, Bel Air",
  evaluator: "Jordan",
  business: "JS Landscaping MD",
  phone: "(443) 819-1521",
  website: "jslandscapingmd.com",
};

/** One line on the state of the sequence, for the top of the panel. */
export function describeSequence(steps: readonly SequenceStep[]): string {
  const on = steps.filter((s) => s.enabled).length;
  if (on === 0) return "All five emails are switched off.";
  if (on === steps.length) return `${on} emails, all switched on.`;
  return `${on} of ${steps.length} emails switched on.`;
}

/** What a step is allowed to look like before it is saved. */
export function validateStep(input: { subject: string; body: string }): string | null {
  const subject = input.subject.trim();
  const body = input.body.trim();
  if (!subject) return "The subject cannot be empty.";
  if (subject.length > 200) return "Keep the subject under 200 characters.";
  if (!body) return "The email needs a body.";
  if (body.length > 5000) return "Keep the email under 5,000 characters.";
  const unknown = unknownPlaceholders(`${subject}\n${body}`);
  if (unknown.length > 0) {
    return `Nothing fills in ${unknown.map((k) => `{${k}}`).join(", ")}. The placeholders are ${PLACEHOLDERS.map((p) => `{${p.key}}`).join(", ")}.`;
  }
  return null;
}
