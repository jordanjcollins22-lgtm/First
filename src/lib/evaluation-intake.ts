/**
 * The pre-evaluation form: what we ask before we drive out.
 *
 * Two jobs. The first is to price: what they want done, where, and the
 * handful of facts about each kind of work that move its price (what is in
 * the beds now, how big the stumps are, whether a machine fits through the
 * gate), plus photos. The second is to settle the questions that stop
 * people saying yes. They tell us what would make them say no, and the form
 * answers it on the spot, in the same words the proposal page uses later;
 * the questions people usually ask before a visit are answered at the end.
 *
 * Five minutes on a phone. If they never open it, the evaluator goes through
 * the same questions with them at the door, on the same page, so the answers
 * land in the same place either way.
 *
 * The questions are data so the form, the evaluator's summary and the
 * talking points all read from one list. Nothing here touches the database.
 */

import { objectionById } from "@/lib/objections";

export type IntakeKind = "multi" | "single" | "text";

export interface IntakeOption {
  value: string;
  label: string;
}

/** Where a question sits on the form. */
export type IntakeSection = "work" | "style" | "decide" | "ask";

export interface IntakeQuestion {
  key: Exclude<keyof IntakeAnswers, "details" | "photos">;
  section: IntakeSection;
  title: string;
  help?: string;
  kind: IntakeKind;
  options?: IntakeOption[];
  /** For a chip question, the free-text field that goes with it. */
  notesKey?: Exclude<keyof IntakeAnswers, "details" | "photos">;
  /**
   * When the notes box shows: once any chip is picked, or once one of these
   * is. Always, when not given. A box nobody needs is one more thing to skip.
   */
  notesWhen?: "any" | string[];
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
  /** The answers to the pricing questions, by question id. */
  details: Record<string, string | string[]>;
  /** Storage paths of the photos they sent, in the job-photos bucket. */
  photos: string[];
}

export const INTAKE_QUESTIONS: IntakeQuestion[] = [
  {
    key: "services",
    section: "work",
    title: "What are you hoping to have done?",
    help: "Tick all that apply. Each part is priced on its own, so more is fine.",
    kind: "multi",
    options: [
      { value: "beds", label: "Beds: mulch, stone or plants" },
      { value: "lawn", label: "Lawn: repair, sod, seed or mowing" },
      { value: "cleanup", label: "Cleanup and trimming" },
      { value: "removal", label: "Shrub, tree or stump removal" },
      { value: "drainage", label: "Drainage or standing water" },
      { value: "hardscape", label: "Patio, walkway or wall" },
      { value: "washing", label: "Soft washing" },
      { value: "other", label: "Something else" },
    ],
    notesKey: "services_other",
    notesPlaceholder: "What else would you like done?",
    notesWhen: ["other"],
  },
  {
    key: "areas",
    section: "work",
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
    section: "style",
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
    notesWhen: "any",
    notesPlaceholder: "A neighbour's yard you like, a colour you hate, anything that helps",
  },
  {
    key: "tried",
    section: "decide",
    title: "Have you tried anything before? What happened?",
    help: "Plants that died, a company that did not work out, a drainage fix that did not take. It saves us repeating it.",
    kind: "text",
  },
  {
    key: "concerns",
    section: "decide",
    title: "What would make you say no?",
    help: "Honest answers here get you a better proposal, not a harder sell. Tick one and we answer it right here.",
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
    notesWhen: ["price", "timing", "unsure_want", "bad_experience", "hoa", "maintenance", "other_quotes"],
  },
  {
    key: "budget",
    section: "decide",
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
    section: "decide",
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
    section: "decide",
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
    section: "ask",
    title: "Anything else you want to ask us before we come?",
    kind: "text",
  },
];

// ---------------------------------------------------------------------------
// The details that set the price
// ---------------------------------------------------------------------------

/**
 * One pricing question. Shown only when they ticked a service it is about,
 * or always when it is about the property itself (services null).
 */
export interface DetailQuestion {
  id: string;
  /** The services it is asked for. Null: asked of every property. */
  services: string[] | null;
  /** Asked only once another answer says it matters. */
  showIf?: { id: string; values: string[] };
  title: string;
  /** How the evaluator's summary names it. */
  short: string;
  /** The heading it sits under on the form: the work it is about. */
  group: string;
  kind: IntakeKind;
  options?: IntakeOption[];
  placeholder?: string;
}

const opts = (...labels: [string, string][]): IntakeOption[] => labels.map(([value, label]) => ({ value, label }));

/**
 * What moves the price of each kind of work, asked in words a homeowner can
 * answer from the kitchen window, and no more of it than changes a number.
 * The evaluator still measures and counts; these are the things a tape
 * measure and a satellite picture do not show. Two questions at most for any
 * one kind of work, and the property is one question of exceptions rather
 * than one question per fact, because most yards have none of them.
 */
export const DETAIL_QUESTIONS: DetailQuestion[] = [
  {
    id: "beds_now",
    services: ["beds"],
    group: "Beds",
    title: "What is in the beds now?",
    short: "Beds now",
    kind: "multi",
    options: opts(["old_mulch", "Old mulch"], ["stone", "Stone or rock"], ["weeds", "Weeds and grass"], ["bare", "Bare soil"], ["lawn", "Lawn (a new bed)"]),
  },
  {
    id: "beds_add",
    services: ["beds"],
    group: "Beds",
    title: "What should go in?",
    short: "Beds get",
    kind: "multi",
    options: opts(["mulch", "Mulch"], ["stone", "Stone or rock"], ["plants", "New plants"], ["edging", "Edging"], ["unsure", "Not sure"]),
  },
  {
    id: "lawn_need",
    services: ["lawn"],
    group: "Lawn",
    title: "What does the lawn need?",
    short: "Lawn needs",
    kind: "multi",
    options: opts(["patch", "Fix bare or thin spots"], ["redo", "Redo the whole lawn"], ["weeds", "Get rid of weeds"], ["level", "Level bumps and dips"], ["mowing", "Regular mowing"]),
  },
  {
    id: "lawn_method",
    services: ["lawn"],
    showIf: { id: "lawn_need", values: ["patch", "redo"] },
    group: "Lawn",
    title: "Sod or seed?",
    short: "Sod or seed",
    kind: "single",
    options: opts(["sod", "Sod, green right away"], ["seed", "Seed, costs less and fills in over a season"], ["unsure", "Not sure, advise me"]),
  },
  {
    id: "cleanup_what",
    services: ["cleanup"],
    group: "Cleanup and trimming",
    title: "What needs doing?",
    short: "Cleanup",
    kind: "multi",
    options: opts(
      ["leaves", "Leaves"],
      ["weeds", "Weeds"],
      ["trim", "Shrubs or hedges to trim"],
      ["tall", "Some over 6 ft tall"],
      ["vines", "Vines or ivy"],
      ["saplings", "Small trees and saplings"],
      ["debris", "Junk to haul away"]
    ),
  },
  {
    id: "remove_what",
    services: ["removal"],
    group: "Removal",
    title: "What is coming out?",
    short: "Removing",
    kind: "multi",
    options: opts(
      ["small", "Shrubs shorter than me"],
      ["large", "Shrubs taller than me"],
      ["trees", "Small trees"],
      ["stumps_small", "Stumps under a foot across"],
      ["stumps_big", "Stumps over a foot across"]
    ),
  },
  {
    id: "water",
    services: ["drainage"],
    group: "Drainage",
    title: "What is the water doing?",
    short: "Water",
    kind: "multi",
    options: opts(
      ["house", "Sitting against the house"],
      ["pools", "Pooling in the yard"],
      ["basement", "Getting into the basement"],
      ["washout", "Washing out beds or mulch"],
      ["every_rain", "After every rain"],
      ["heavy_rain", "Only after heavy rain"]
    ),
  },
  {
    id: "hard_what",
    services: ["hardscape"],
    group: "Patio, walkway or wall",
    title: "What would you like built?",
    short: "Build",
    kind: "multi",
    options: opts(["patio", "Patio"], ["walkway", "Walkway"], ["wall", "Retaining wall"], ["steps", "Steps"], ["fire_pit", "Fire pit"]),
  },
  {
    id: "hard_material",
    services: ["hardscape"],
    group: "Patio, walkway or wall",
    title: "In what?",
    short: "Material",
    kind: "single",
    options: opts(["pavers", "Pavers"], ["stone", "Natural stone"], ["concrete", "Concrete"], ["gravel", "Gravel"], ["unsure", "Not sure"]),
  },
  {
    id: "wash_what",
    services: ["washing"],
    group: "Soft washing",
    title: "What needs washing?",
    short: "Washing",
    kind: "multi",
    options: opts(["siding", "House siding"], ["roof", "Roof"], ["deck", "Deck"], ["fence", "Fence"], ["paving", "Patio or walkway"]),
  },
  {
    id: "stories",
    services: ["washing"],
    showIf: { id: "wash_what", values: ["siding", "roof"] },
    group: "Soft washing",
    title: "How many stories is the house?",
    short: "Stories",
    kind: "single",
    options: opts(["1", "1"], ["2", "2"], ["3", "3 or more"]),
  },
  // The property, whatever the work: only what is out of the ordinary.
  {
    id: "yard",
    services: null,
    group: "The property",
    title: "Tick anything that is true of the yard",
    short: "Yard",
    kind: "multi",
    options: opts(
      ["narrow_gate", "Gate under 3 ft wide"],
      ["steep", "Steep slope"],
      ["sprinklers", "Sprinklers"],
      ["dog_fence", "Invisible dog fence"],
      ["dog", "A dog in the yard"],
      ["street", "No driveway parking for a truck"]
    ),
    placeholder: "Gate code, where to park, anything else about getting in",
  },
];

/** Old answers from before services were merged, read as today's. */
const SERVICE_MERGED: Record<string, string> = { mulch: "beds", trimming: "cleanup", lawn_care: "lawn", lighting: "other" };

/** Whether a question's condition on another answer is met. */
export function detailShown(question: DetailQuestion, details: IntakeAnswers["details"]): boolean {
  if (!question.showIf) return true;
  const value = details[question.showIf.id];
  const picked = Array.isArray(value) ? value : value ? [value] : [];
  return picked.some((v) => question.showIf!.values.includes(v));
}

/**
 * The pricing questions for what they ticked, in order, then the property's.
 * With their answers so far, a question that depends on another is left
 * out until that answer says it matters.
 */
export function detailQuestionsFor(services: string[], details?: IntakeAnswers["details"]): DetailQuestion[] {
  const picked = new Set(services);
  return DETAIL_QUESTIONS.filter(
    (q) => (q.services === null || q.services.some((s) => picked.has(s))) && (!details || detailShown(q, details))
  );
}

/** Most photos one form keeps. Enough for every side of a house. */
export const MAX_INTAKE_PHOTOS = 8;

// ---------------------------------------------------------------------------
// Answering what would make them say no
// ---------------------------------------------------------------------------

export interface IntakeAnswer {
  heading: string;
  body: string;
}

function fromCatalogue(id: string, heading: string): IntakeAnswer {
  return { heading, body: objectionById(id)?.answer ?? "" };
}

/**
 * What the form says back when they tick a reason they might say no.
 *
 * Where the proposal page already has an answer, it is that answer word for
 * word, so the client never hears one thing before the visit and another
 * after it. The rest are what the evaluator would say on the walk.
 */
export const CONCERN_ANSWERS: Record<string, IntakeAnswer[]> = {
  price: [
    {
      heading: "How the price is worked out",
      body:
        "You get one fixed price, area by area, after the visit. It covers the crew's time, the materials, hauling the waste away and the insurance, so there is nothing added at the end. If it is more than you had in mind, there are two honest ways around it: spread it over a few payments, or keep the parts that matter most now and leave the rest for later. The budget question below helps us design to your number from the start.",
    },
    fromCatalogue("cannot_pay_at_once", "Can I split it into payments?"),
  ],
  timing: [
    {
      heading: "When we could start",
      body:
        "Tell us the date you are aiming at, below or on the visit, and we will say honestly whether we can hit it rather than promise it and slip. We work outdoors, so heavy rain or frozen ground can move a day. If that happens we tell you as soon as we know and you keep your place at the front of the schedule.",
    },
  ],
  unsure_want: [
    {
      heading: "Not knowing yet is normal",
      body:
        "That is what the visit is for. You do not have to design anything. We bring two or three looks that suit your yard and you tell us what you like. Ticking a few colours or styles below helps, and so does Not sure.",
    },
  ],
  bad_experience: [
    fromCatalogue("havent_used_you", "Who you are dealing with"),
    fromCatalogue("not_happy", "If you are not happy with something"),
  ],
  hoa: [
    {
      heading: "HOA and permit rules",
      body:
        "Send us the rules or have them handy on the visit. We design within them, and the approval step goes into the proposal, so nothing starts until it is approved.",
    },
  ],
  maintenance: [
    {
      heading: "Keeping it looking good",
      body:
        "Tell us how much time you want to spend on it. We can plan around low-maintenance plants and tell you, in hours a year, what the yard will need once it is done.",
    },
  ],
  other_quotes: [fromCatalogue("getting_other_quotes", "Comparing quotes")],
};

/** Every answer for what they ticked, each once, in the order they ticked. */
export function answersForConcerns(concerns: string[]): IntakeAnswer[] {
  const seen = new Set<string>();
  const out: IntakeAnswer[] = [];
  for (const concern of concerns) {
    for (const answer of CONCERN_ANSWERS[concern] ?? []) {
      if (!answer.body || seen.has(answer.heading)) continue;
      seen.add(answer.heading);
      out.push(answer);
    }
  }
  return out;
}

/**
 * The questions people ask before a visit, answered before they have to ask.
 * The same catalogue as the proposal page wherever the wording fits a visit
 * that has not happened yet.
 */
export const BEFORE_VISIT_QUESTIONS: IntakeAnswer[] = [
  {
    heading: "Is the visit really free?",
    body:
      "Yes. There is nothing to pay and nothing to sign. We walk the property with you, measure, take photos, and send you a fixed-price proposal afterwards. If it is not for you, that is the end of it.",
  },
  fromCatalogue("havent_used_you", "Are you licensed and insured?"),
  fromCatalogue("who_comes", "Who will be at my property?"),
  fromCatalogue("cannot_pay_at_once", "Can I split it into payments?"),
  {
    heading: "How do I pay?",
    body:
      "Card, Apple Pay, Google Pay, check or bank transfer, whichever suits you. Nothing is due until you accept the proposal.",
  },
  fromCatalogue("weather_delay", "What happens if the weather is bad?"),
  fromCatalogue("not_happy", "What if I am not happy with something?"),
  {
    heading: "Can I do just part of it?",
    body:
      "Of course. The proposal is priced area by area, so you can keep the parts that are bothering you now and leave the rest for later. Anything you leave off stays on file for whenever you are ready.",
  },
].filter((a) => a.body);

// ---------------------------------------------------------------------------
// Cleaning and reading the answers
// ---------------------------------------------------------------------------

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
    details: {},
    photos: [],
  };
}

const TEXT_LIMIT = 2000;

function pick(kind: IntakeKind, options: IntakeOption[] | undefined, value: unknown): string | string[] {
  if (kind === "text") return text(value);
  const allowed = new Set((options ?? []).map((o) => o.value));
  if (kind === "multi") {
    const picked = Array.isArray(value) ? value.filter((v): v is string => typeof v === "string" && allowed.has(v)) : [];
    return [...new Set(picked)];
  }
  return typeof value === "string" && allowed.has(value) ? value : "";
}

function filled(value: string | string[] | undefined): boolean {
  return Array.isArray(value) ? value.length > 0 : Boolean(value);
}

/**
 * Whatever came in, made safe.
 *
 * Only the options we offered survive in a chip question; free text is
 * trimmed and capped. Anything else in the object is dropped, so the row
 * only ever holds the shape the form was built for. Photos are paths and
 * are only kept here; which paths are really this form's is the caller's
 * check, since that needs the job.
 */
export function cleanAnswers(input: unknown): IntakeAnswers {
  const raw = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const out = emptyAnswers();
  for (const question of INTAKE_QUESTIONS) {
    out[question.key] = pick(question.kind, question.options, raw[question.key]) as never;
    if (question.notesKey) out[question.notesKey] = text(raw[question.notesKey]) as never;
  }
  // Services from before some were merged count as the one they became.
  if (Array.isArray(raw.services)) {
    const merged = raw.services.map((v) => (typeof v === "string" ? SERVICE_MERGED[v] ?? v : v));
    out.services = pick("multi", INTAKE_QUESTIONS[0].options, merged) as string[];
  }
  const details = (raw.details && typeof raw.details === "object" ? raw.details : {}) as Record<string, unknown>;
  for (const question of DETAIL_QUESTIONS) {
    const value = pick(question.kind, question.options, details[question.id]);
    if (filled(value)) out.details[question.id] = value;
    if (question.placeholder && question.kind !== "text") {
      const notes = text(details[`${question.id}_notes`]);
      if (notes) out.details[`${question.id}_notes`] = notes;
    }
  }
  out.photos = Array.isArray(raw.photos)
    ? [...new Set(raw.photos.filter((p): p is string => typeof p === "string" && /^[\w-]+\/intake-[\w-]+\.(jpg|png|webp)$/.test(p)))].slice(0, MAX_INTAKE_PHOTOS)
    : [];
  return out;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim().slice(0, TEXT_LIMIT) : "";
}

/** How many of the questions have anything in them, photos counting as one. */
export function answeredCount(answers: IntakeAnswers): number {
  const main = INTAKE_QUESTIONS.filter((q) => {
    const notes = q.notesKey ? String(answers[q.notesKey] ?? "") : "";
    return filled(answers[q.key]) || Boolean(notes);
  }).length;
  const details = DETAIL_QUESTIONS.filter((q) => filled(answers.details[q.id])).length;
  return main + details + (answers.photos.length > 0 ? 1 : 0);
}

/** Whether a question's notes box is showing, given what is picked. */
export function notesShown(question: IntakeQuestion, answers: IntakeAnswers): boolean {
  if (!question.notesKey) return false;
  // Something already written stays in view, whatever is picked.
  if (answers[question.notesKey]) return true;
  if (!question.notesWhen) return true;
  const value = answers[question.key];
  const picked = Array.isArray(value) ? value : value ? [value] : [];
  return question.notesWhen === "any" ? picked.length > 0 : picked.some((v) => question.notesWhen!.includes(v));
}

export function labelOf(question: { options?: IntakeOption[] }, value: string): string {
  return question.options?.find((o) => o.value === value)?.label ?? value;
}

function shownValue(question: { kind: IntakeKind; options?: IntakeOption[] }, value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value.map((v) => labelOf(question, v)).join(", ");
  if (!value) return "";
  return question.kind === "text" ? value : labelOf(question, value);
}

/** The answers as the evaluator reads them: one line per question answered. */
export function summarizeIntake(answers: IntakeAnswers): { label: string; value: string }[] {
  const lines: { label: string; value: string }[] = [];
  for (const q of INTAKE_QUESTIONS) {
    const notes = q.notesKey ? String(answers[q.notesKey] ?? "") : "";
    let shown = shownValue(q, answers[q.key]);
    if (notes) shown = shown ? `${shown}. ${notes}` : notes;
    if (shown) lines.push({ label: SHORT_LABEL[q.key] ?? q.title, value: shown });
  }
  return lines;
}

/** The pricing answers, for the evaluator, one line each. */
export function summarizeDetails(answers: IntakeAnswers): { label: string; value: string }[] {
  const lines: { label: string; value: string }[] = [];
  for (const q of DETAIL_QUESTIONS) {
    const notes = answers.details[`${q.id}_notes`];
    let shown = shownValue(q, answers.details[q.id]);
    if (typeof notes === "string" && notes) shown = shown ? `${shown}. ${notes}` : notes;
    if (shown) lines.push({ label: q.short, value: shown });
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
  if (!answers || (!submittedAt && answeredCount(answers) === 0)) return "Not filled in yet. Go through it together in the first 5 to 10 minutes.";
  if (!submittedAt) return `Started, not sent: ${answeredCount(answers)} answered. Finish it together at the door.`;
  const q = INTAKE_QUESTIONS[0];
  const wants = answers.services.map((v) => labelOf(q, v));
  const budget = answers.budget ? labelOf(INTAKE_QUESTIONS.find((x) => x.key === "budget")!, answers.budget) : "";
  return [wants.slice(0, 3).join(", "), budget].filter(Boolean).join(" · ") || "Filled in.";
}

/**
 * What to do with the answers on the walk.
 *
 * Each concern they ticked becomes a thing to say or do, in order of how
 * often it loses the job, then what the property answers change about the
 * price. Written for the evaluator, not the client.
 */
export function talkingPoints(answers: IntakeAnswers): string[] {
  const points: string[] = [];
  const has = (c: string) => answers.concerns.includes(c);
  const detail = (id: string) => answers.details[id];
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

  // What the property and the work change about the price.
  const has2 = (id: string, value: string) => {
    const v = detail(id);
    return Array.isArray(v) ? v.includes(value) : v === value;
  };
  if (has2("yard", "narrow_gate")) points.push("The way in is under 3 ft. No machine gets through: price it as hand work and wheelbarrow runs.");
  if (has2("yard", "steep")) points.push("Steep ground. Allow for slower work and for holding mulch or soil on the slope.");
  if (has2("yard", "sprinklers") || has2("yard", "dog_fence")) {
    points.push("Something is buried in the yard. Find the sprinkler heads or dog fence wire before anyone digs, and note them on the map.");
  }
  if (has2("yard", "street")) points.push("Materials get dropped at the street. Price the extra carrying.");
  if (has2("yard", "dog")) points.push("A dog uses the yard. Agree when it is kept in, and keep the gate shut.");
  if (has2("remove_what", "stumps_big")) points.push("Big stumps. Check grinder access and whether the stump is near anything buried.");
  if (has2("water", "basement")) points.push("Water reaches the basement. Look at the downspouts and the grade against the house first.");
  if (has2("beds_now", "stone")) points.push("There is stone in the beds now. Price taking it out if they want mulch instead.");
  if (answers.photos.length > 0) points.push(`They sent ${answers.photos.length} photo${answers.photos.length === 1 ? "" : "s"}. Look before you go, and draft the price from them if you can.`);
  return points;
}
