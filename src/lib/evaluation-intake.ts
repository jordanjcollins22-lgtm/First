/**
 * The pre-evaluation form: what we ask before we drive out.
 *
 * What they want done, where, the colours and looks they like, what they
 * have tried before, what would make them say no, and the practical three:
 * budget, timing, who decides. Five minutes on a phone. If they never open
 * it, the evaluator goes through the same questions with them at the door,
 * on the same page, so the answers land in the same place either way.
 *
 * The questions are data so the form, the evaluator's summary and the
 * talking points all read from one list. Nothing here touches the database.
 */

export type IntakeKind = "multi" | "single" | "text";

export interface IntakeOption {
  value: string;
  label: string;
}

export interface IntakeQuestion {
  key: keyof IntakeAnswers;
  title: string;
  help?: string;
  kind: IntakeKind;
  options?: IntakeOption[];
  /** For a chip question, the free-text field that goes with it. */
  notesKey?: keyof IntakeAnswers;
  notesPlaceholder?: string;
}

export interface IntakeAnswers {
  services: string[];
  services_other: string;
  areas: string[];
  looks: string[];
  looks_notes: string;
  tried: string;
  concerns: string[];
  concerns_notes: string;
  budget: string;
  timing: string;
  decision: string;
  questions: string;
}

export const INTAKE_QUESTIONS: IntakeQuestion[] = [
  {
    key: "services",
    title: "What are you hoping to have done?",
    help: "Tick everything that applies. We price each area separately, so more is fine.",
    kind: "multi",
    options: [
      { value: "beds", label: "Landscape beds and plantings" },
      { value: "mulch", label: "Mulch or stone in the beds" },
      { value: "lawn", label: "Lawn: sod, seeding or repair" },
      { value: "hardscape", label: "Patio, walkway or wall" },
      { value: "drainage", label: "Drainage or standing water" },
      { value: "removal", label: "Tree, shrub or stump removal" },
      { value: "cleanup", label: "Cleanup and overgrowth" },
      { value: "lighting", label: "Outdoor lighting" },
      { value: "other", label: "Something else" },
    ],
    notesKey: "services_other",
    notesPlaceholder: "Anything else, or more detail on the above",
  },
  {
    key: "areas",
    title: "Which parts of the property?",
    kind: "multi",
    options: [
      { value: "front", label: "Front yard" },
      { value: "back", label: "Back yard" },
      { value: "sides", label: "Side yards" },
      { value: "foundation", label: "Around the house" },
      { value: "whole", label: "The whole property" },
    ],
  },
  {
    key: "looks",
    title: "What colours and looks do you like?",
    help: "There is no wrong answer. Not sure is a real answer and we will bring options.",
    kind: "multi",
    options: [
      { value: "classic", label: "Greens and whites, classic" },
      { value: "cool", label: "Purples and blues" },
      { value: "warm", label: "Reds, oranges and yellows" },
      { value: "native", label: "Natural, native plants" },
      { value: "modern", label: "Modern, clean lines" },
      { value: "cottage", label: "Full and flowery" },
      { value: "low", label: "Low maintenance above all" },
      { value: "unsure", label: "Not sure, show me options" },
    ],
    notesKey: "looks_notes",
    notesPlaceholder: "A neighbour's yard you like, a colour you hate, anything that helps",
  },
  {
    key: "tried",
    title: "Have you tried anything before? What happened?",
    help: "Plants that died, a company that did not work out, a drainage fix that did not take. It saves us repeating it.",
    kind: "text",
  },
  {
    key: "concerns",
    title: "What would make you say no?",
    help: "Honest answers here get you a better proposal, not a harder sell.",
    kind: "multi",
    options: [
      { value: "price", label: "The price" },
      { value: "timing", label: "The timing" },
      { value: "unsure_want", label: "Not sure what I want yet" },
      { value: "bad_experience", label: "A bad experience with a contractor" },
      { value: "hoa", label: "HOA or permit rules" },
      { value: "maintenance", label: "Worried about upkeep" },
      { value: "other_quotes", label: "Getting other quotes" },
      { value: "nothing", label: "Nothing, I am ready" },
    ],
    notesKey: "concerns_notes",
    notesPlaceholder: "Anything you want to say about that",
  },
  {
    key: "budget",
    title: "Is there a budget range in mind?",
    help: "Even a wide one lets us design to what you will actually do.",
    kind: "single",
    options: [
      { value: "under_2500", label: "Under $2,500" },
      { value: "2500_5000", label: "$2,500 to $5,000" },
      { value: "5000_10000", label: "$5,000 to $10,000" },
      { value: "10000_25000", label: "$10,000 to $25,000" },
      { value: "over_25000", label: "Over $25,000" },
      { value: "unsure", label: "Not sure yet" },
    ],
  },
  {
    key: "timing",
    title: "When would you like it done?",
    kind: "single",
    options: [
      { value: "asap", label: "As soon as possible" },
      { value: "season", label: "This season" },
      { value: "next_season", label: "Next season" },
      { value: "planning", label: "Just planning for now" },
    ],
  },
  {
    key: "decision",
    title: "Who else is part of the decision?",
    kind: "single",
    options: [
      { value: "me", label: "Just me" },
      { value: "partner", label: "My partner or spouse" },
      { value: "family", label: "Family or a landlord" },
      { value: "hoa", label: "An HOA or board" },
    ],
  },
  {
    key: "questions",
    title: "Anything you want to ask us before we come?",
    kind: "text",
  },
];

export function emptyAnswers(): IntakeAnswers {
  return {
    services: [],
    services_other: "",
    areas: [],
    looks: [],
    looks_notes: "",
    tried: "",
    concerns: [],
    concerns_notes: "",
    budget: "",
    timing: "",
    decision: "",
    questions: "",
  };
}

const TEXT_LIMIT = 2000;

/**
 * Whatever came in, made safe.
 *
 * Only the options we offered survive in a chip question; free text is
 * trimmed and capped. Anything else in the object is dropped, so the row
 * only ever holds the shape the form was built for.
 */
export function cleanAnswers(input: unknown): IntakeAnswers {
  const raw = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const out = emptyAnswers();
  for (const question of INTAKE_QUESTIONS) {
    const value = raw[question.key];
    if (question.kind === "text") {
      out[question.key] = text(value) as never;
      continue;
    }
    const allowed = new Set((question.options ?? []).map((o) => o.value));
    if (question.kind === "multi") {
      const picked = Array.isArray(value) ? value.filter((v): v is string => typeof v === "string" && allowed.has(v)) : [];
      out[question.key] = [...new Set(picked)] as never;
    } else {
      out[question.key] = (typeof value === "string" && allowed.has(value) ? value : "") as never;
    }
    if (question.notesKey) out[question.notesKey] = text(raw[question.notesKey]) as never;
  }
  return out;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim().slice(0, TEXT_LIMIT) : "";
}

/** How many of the questions have anything in them. */
export function answeredCount(answers: IntakeAnswers): number {
  return INTAKE_QUESTIONS.filter((q) => {
    const value = answers[q.key];
    const notes = q.notesKey ? String(answers[q.notesKey] ?? "") : "";
    return (Array.isArray(value) ? value.length > 0 : Boolean(value)) || Boolean(notes);
  }).length;
}

export function labelOf(question: IntakeQuestion, value: string): string {
  return question.options?.find((o) => o.value === value)?.label ?? value;
}

/** The answers as the evaluator reads them: one line per question answered. */
export function summarizeIntake(answers: IntakeAnswers): { label: string; value: string }[] {
  const lines: { label: string; value: string }[] = [];
  for (const q of INTAKE_QUESTIONS) {
    const value = answers[q.key];
    const notes = q.notesKey ? String(answers[q.notesKey] ?? "") : "";
    let shown = "";
    if (Array.isArray(value)) shown = value.map((v) => labelOf(q, v)).join(", ");
    else if (q.kind === "single") shown = value ? labelOf(q, value) : "";
    else shown = typeof value === "string" ? value : "";
    if (notes) shown = shown ? `${shown}. ${notes}` : notes;
    if (shown) lines.push({ label: SHORT_LABEL[q.key] ?? q.title, value: shown });
  }
  return lines;
}

const SHORT_LABEL: Partial<Record<keyof IntakeAnswers, string>> = {
  services: "Wants",
  areas: "Where",
  looks: "Looks",
  tried: "Tried before",
  concerns: "Would say no over",
  budget: "Budget",
  timing: "When",
  decision: "Decides",
  questions: "Asked us",
};

/** The one line under the section title. */
export function intakeHeadline(answers: IntakeAnswers | null, submittedAt: string | null): string {
  if (!answers || !submittedAt) return "Not filled in yet. Go through it together in the first 5 to 10 minutes.";
  const q = INTAKE_QUESTIONS[0];
  const wants = answers.services.map((v) => labelOf(q, v));
  const budget = answers.budget ? labelOf(INTAKE_QUESTIONS.find((x) => x.key === "budget")!, answers.budget) : "";
  return [wants.slice(0, 3).join(", "), budget].filter(Boolean).join(" · ") || "Filled in.";
}

/**
 * What to do with the answers on the walk.
 *
 * Each concern they ticked becomes a thing to say or do, in order of how
 * often it loses the job. Written for the evaluator, not the client.
 */
export function talkingPoints(answers: IntakeAnswers): string[] {
  const points: string[] = [];
  const has = (c: string) => answers.concerns.includes(c);
  const budgetLabel = answers.budget ? labelOf(INTAKE_QUESTIONS.find((x) => x.key === "budget")!, answers.budget) : null;

  if (has("price")) {
    points.push(
      budgetLabel && answers.budget !== "unsure"
        ? `Price is the worry and they gave ${budgetLabel}. Price the must-do first and show what fits inside that number, then the rest as a second phase.`
        : "Price is the worry and they gave no range. Ask for one on the walk before you measure anything, and price the must-do first."
    );
  }
  if (has("other_quotes")) {
    points.push("They are getting other quotes. Say what is included that a cheaper quote usually leaves out: prep, soil, plant warranty, cleanup.");
  }
  if (has("bad_experience")) {
    points.push("A contractor let them down before. Ask what happened and say plainly how we do that part differently. Do not skip it.");
  }
  if (has("unsure_want")) {
    points.push("They do not know what they want yet. Bring two or three looks on the phone and let them react. Do not ask them to design it.");
  }
  if (has("maintenance")) {
    points.push("Upkeep worries them. Steer to low-maintenance plants and say what the yard needs per year in hours, not in plant names.");
  }
  if (has("hoa")) {
    points.push("HOA or permits. Ask for the rules before you draw anything, and put the approval step in the proposal.");
  }
  if (has("timing")) {
    points.push("Timing is a concern. Tell them the real start window and what happens if the weather slips it.");
  }
  if (answers.decision && answers.decision !== "me") {
    points.push("Somebody else has a say. If they are not there, ask what that person will want to know and answer it in the proposal.");
  }
  if (answers.tried) {
    points.push(`They have tried before: "${answers.tried.slice(0, 140)}". Say why this time is different before they ask.`);
  }
  if (answers.looks.includes("unsure")) {
    points.push("No colour preference yet. Show three planting palettes and note which one they warm to.");
  }
  if (answers.questions) {
    points.push(`They asked: "${answers.questions.slice(0, 140)}". Answer it in the first minute.`);
  }
  return points;
}
