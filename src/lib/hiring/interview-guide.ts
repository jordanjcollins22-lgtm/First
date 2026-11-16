import { cultureFor, roleDocFor } from "@/lib/hiring/role-docs";
import type { ApplicantCall } from "@/lib/hiring/recordings";

/**
 * What to cover on an interview call, step by step, with a place for notes
 * on each part. Alex's step 3, the first interview: their background,
 * competence and values, and what the first 2-3 months would look like.
 * Step 5, the owner call: culture fit and values, said straight about the
 * job's hard parts and what gets someone let go.
 */

export interface GuideSection {
  key: string;
  title: string;
  /** Said to them, word for word or close to it. */
  say?: readonly string[];
  /** Asked, then listened to. */
  ask: readonly string[];
  /** What a good answer sounds like. */
  listenFor?: string;
}

/** One question per value, the same order as the values. Affiliate first. */
const VALUE_QUESTIONS: Record<string, readonly string[]> = {
  affiliate: [
    "Tell me about a time you went past what was asked to help someone.",
    "If you tell someone we'll reach out today, what do you do to make sure it happens?",
    "Would you rather show someone our before and after photos, or tell them we're great? Why?",
    "You're paid only when a job closes. How do you feel about that, and what would you do to help it close?",
    "Tell me about something you learned and then taught someone else.",
  ],
};

function firstMonths(position: string): GuideSection | null {
  const doc = roleDocFor(position);
  if (!doc) return null;
  return {
    key: "first-months",
    title: "Their first 2-3 months",
    say: [
      ...(doc.firstTwoWeeks ?? []).map((d) => `${d.when}: ${d.what}`),
      ...doc.plan.map((m) => `By day ${m.day}: ${m.goal}`),
    ],
    ask: ["Does that sound like something you'd do every week?", "What would get in the way?"],
  };
}

const AFFILIATE_FIRST: readonly GuideSection[] = [
  {
    key: "background",
    title: "Their background",
    ask: [
      "Tell me about yourself and where you live. How long have you been around here?",
      "Who do you know around here: neighbors, friends, family, coworkers, groups online?",
      "What work have you done before? Anything with people, sales or customer service?",
      "Have you ever recommended a business to someone? What happened?",
    ],
  },
  {
    key: "competence",
    title: "Can they do the job?",
    ask: [
      "How do you usually keep in touch with people: texting, Facebook, Nextdoor, in person?",
      "Someone asks what it will cost. What do you tell them?",
      "How are you with apps on your phone, like copying a link and sending it in a message?",
    ],
    listenFor: "Friendly and natural, not salesy. They don't guess a price or a date: they say we'll reach out to set up an estimate.",
  },
];

const AFFILIATE_OWNER: readonly GuideSection[] = [
  {
    key: "values",
    title: "Culture and values",
    ask: [
      "Which of our five values matters most to you, and why?",
      "Tell me about a time someone pushed you to stretch the truth to make a sale or keep someone happy. What did you do?",
      "If someone you sent had a bad experience with us, what would you do?",
    ],
    listenFor: "Honest even when it costs them, and they own it when something goes wrong.",
  },
  {
    key: "hard-parts",
    title: "The hard parts, said plainly",
    say: [
      "It's commission only: 4% of each job that books through your link, paid after the client pays. There's no hourly pay, and nothing for a job that doesn't close.",
      "Most people you send will say no, or not yet. That's normal.",
      "It takes steady effort: sharing your link and answering posts most days, not once in a while.",
      "We only work in Harford County, so we can't help people farther away.",
    ],
    ask: ["Knowing all that, do you still want to do this?"],
  },
  {
    key: "let-go",
    title: "What gets someone let go",
    say: [
      "Lying to people, or about us.",
      "Promising a price, a date or free work. We give the price once we've looked at their yard.",
      "Spamming groups or people with your link.",
      "Knowingly sending us people we can't serve, like work we don't do or someone outside Harford County.",
      "Being pushy or rude to anyone, in person or online.",
    ],
    ask: ["Any questions about those?"],
  },
  {
    key: "their-questions",
    title: "Their questions",
    ask: ["What questions do you have for me?", "Is there anything about the job that worries you?"],
  },
];

/** The guide for one call with one applicant, or null when that job's guide isn't written yet. */
export function interviewGuide(position: string | null | undefined, call: ApplicantCall): GuideSection[] | null {
  if (position !== "affiliate") return null;
  if (call === "interview") {
    const values = cultureFor(position).map((c, i) => ({ value: c.value, q: VALUE_QUESTIONS.affiliate[i] }));
    const months = firstMonths(position);
    return [
      ...AFFILIATE_FIRST,
      { key: "values", title: "Our five values", ask: values.map((v) => `${v.value}: ${v.q}`) },
      ...(months ? [months] : []),
    ];
  }
  if (call === "owner_talk") return [...AFFILIATE_OWNER];
  return null;
}
