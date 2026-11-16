import type { ApplicantDetail, ApplicantRow } from "@/lib/data/hiring";
import type { JourneyView, NewHireLine, StepRow } from "@/lib/data/journey";
import { checkInsThrough, trainingKey } from "@/lib/hiring/journey";
import { roleDocFor } from "@/lib/hiring/role-docs";

/**
 * Sample people for the no-login affiliate preview (/review/hiring/affiliate):
 * every page built for hiring an affiliate through to fully operating, shown
 * with made-up data so the owner can see it without signing in.
 */

export interface PreviewPage {
  key: string;
  /** Alex's steps this page covers, in his order. */
  steps: { id: string; name: string }[];
  title: string;
  what: string;
}

/** In Alex's order, from writing the job down to fully operating. */
export const AFFILIATE_PREVIEW_PAGES: readonly PreviewPage[] = [
  {
    key: "docs",
    title: "Job documents",
    steps: [
      { id: "0.1", name: "Define the role" },
      { id: "0.4", name: "Document the job" },
      { id: "11", name: "Clarity: 30-60-90 plan" },
      { id: "12", name: "Culture" },
      { id: "15", name: "Document the task" },
    ],
    what: "The role, the Four Rs, a perfect day, the 30-60-90 day plan, our culture and the task checklists training runs on.",
  },
  {
    key: "job",
    title: "Careers page and application",
    steps: [
      { id: "0.2", name: "Define what you offer" },
      { id: "0.3", name: "Choose the experience level" },
      { id: "0.5", name: "Picture the perfect fit" },
      { id: "0.9", name: "Keep the application simple" },
    ],
    what: "What an applicant sees: the pitch, pay, where the job goes, who we're looking for, and the questions.",
  },
  {
    key: "board",
    title: "Hiring board",
    steps: [
      { id: "0.6", name: "Write the ad" },
      { id: "0.7", name: "Revise the ad" },
      { id: "0.11", name: "Expect volume" },
      { id: "1", name: "Application received" },
    ],
    what: "The Indeed ad ready to paste, its checklist, how many applicants one hire takes, and who applied.",
  },
  {
    key: "video",
    title: "Video step",
    steps: [{ id: "2", name: "Screening call" }],
    what: "What an applicant who passed the questions sees: the one-minute video instead of a phone screen.",
  },
  {
    key: "skills",
    title: "Skills question",
    steps: [{ id: "4", name: "Second interview: skills" }],
    what: "What the applicant sees from the link in their email: one real situation, answered from their phone in writing or with a recording.",
  },
  {
    key: "applicant",
    title: "Applicant page",
    steps: [
      { id: "3", name: "First interview: history and values (phone or video)" },
      { id: "4", name: "Second interview: skills (their answer)" },
      { id: "5", name: "Third interview: owner and culture (phone or video)" },
      { id: "6", name: "Optional 4th interview, then decide" },
    ],
    what: "One applicant: answers, video, their skills answer, your rating and note, and the next step. Interviews for this job are calls, never in person.",
  },
  {
    key: "emails",
    title: "Emails they get",
    steps: [
      { id: "7", name: "Job offer sent" },
      { id: "8", name: "Offer accepted" },
      { id: "9", name: "Pre-onboarding" },
    ],
    what: "The video request, interview invite, offer and welcome emails, word for word.",
  },
  {
    key: "new-hire",
    title: "New hire page",
    steps: [
      { id: "11", name: "Clarity: 30-60-90 plan" },
      { id: "12", name: "Culture" },
      { id: "13", name: "Connection: a technician" },
      { id: "14", name: "Check-back: twice a day" },
      { id: "16", name: "Demonstrate" },
      { id: "17", name: "Duplicate: they do, you watch" },
      { id: "18", name: "Released to work alone" },
      { id: "19", name: "30-60-90 reviews" },
      { id: "20", name: "Taper check-ins" },
      { id: "21", name: "Fully operating" },
      { id: "Levels", name: "Alex's three levels" },
    ],
    what: "One new affiliate from day one: plan and culture gone through, their technician, check-ins, training sign-offs, reviews, fully operating and level.",
  },
];

export function previewPage(key: string): PreviewPage | null {
  return AFFILIATE_PREVIEW_PAGES.find((p) => p.key === key) ?? null;
}

const SAMPLE_ID = "00000000-0000-4000-8000-00000000a001";

function daysAgo(today: string, n: number): string {
  return new Date(Date.parse(`${today}T12:00:00Z`) - n * 86_400_000).toISOString().slice(0, 10);
}

function at(date: string, time = "15:00:00"): string {
  return `${date}T${time}Z`;
}

/** Applicants at each point of the affiliate funnel. */
export function sampleApplicants(today: string): ApplicantRow[] {
  const base = { email: "sample@example.com", phone: "(410) 555-0100", zip: "21014", position: "affiliate" as const, source: "indeed", screenReasons: [], rating: null, videoSubmittedAt: null, interviewAt: null };
  return [
    { ...base, id: SAMPLE_ID, name: "Dana Sample", stage: "working_interview", rating: 4, createdAt: at(daysAgo(today, 3)), videoSubmittedAt: at(daysAgo(today, 2)), interviewAt: at(today, "18:00:00") },
    { ...base, id: "00000000-0000-4000-8000-00000000a002", name: "Chris Example", stage: "video_submitted", createdAt: at(daysAgo(today, 1)), videoSubmittedAt: at(today, "13:00:00") },
    { ...base, id: "00000000-0000-4000-8000-00000000a003", name: "Sam Placeholder", stage: "video_requested", createdAt: at(today, "12:00:00") },
    { ...base, id: "00000000-0000-4000-8000-00000000a004", name: "Pat Demo", stage: "screened_out", screenReasons: ["Not local to Harford County"], createdAt: at(daysAgo(today, 4)) },
  ];
}

export function sampleApplicant(today: string): ApplicantDetail {
  const row = sampleApplicants(today)[0];
  return {
    ...row,
    answers: {
      age18: "Yes",
      work_auth: "Yes",
      smartphone: "Yes",
      commission_only: "Yes",
      local: "Yes",
      facebook: "Yes",
      start: "Right away",
      why: "I know half the street and people always ask me who does yards around here. I'd rather send them somewhere good and get paid for it.",
      heard: "Indeed",
      skills_at: at(today, "14:00:00"),
    },
    reviewNote: "Friendly on the call, knows a lot of people in Bel Air. Skills answer reads natural, link shared. Owner call next.",
    videoUrl: null,
    videoLink: null,
    skillsVideoUrl: null,
    events: [
      { at: row.createdAt, kind: "applied", detail: null, actorName: null },
      { at: row.videoSubmittedAt!, kind: "video_submitted", detail: null, actorName: null },
      { at: row.videoSubmittedAt!, kind: "stage_changed", detail: { to: "interview" }, actorName: "Jordan" },
      { at: at(daysAgo(today, 1)), kind: "email_sent", detail: { kind: "skills_question" }, actorName: "Jordan" },
      { at: at(today, "14:00:00"), kind: "skills_answered", detail: null, actorName: null },
    ],
  };
}

export function sampleNewHires(today: string): NewHireLine[] {
  return [{ id: SAMPLE_ID, name: "Morgan Sample", position: "affiliate", startDate: daysAgo(today, 34) }];
}

/** A new affiliate 34 days in: twice-weekly check-ins, two tasks released, the 30 day review done. */
export function sampleJourney(today: string): JourneyView {
  const startDate = daysAgo(today, 34);
  const tasks = (roleDocFor("affiliate")?.tasks ?? []).map((t) => t.key);
  const step = (kind: StepRow["kind"], key: string, date: string, note: string | null = null): StepRow => ({ kind, key, doneAt: at(date), doneByName: "Jordan", note });
  // Moved to once a day after week 3, and to twice a week on day 29, when the manager said they were ready.
  const taper = { daily: daysAgo(today, 20), twice_weekly: daysAgo(today, 6) };
  const steps: StepRow[] = [
    step("taper", "daily", taper.daily, "Answering posts on their own, fewer questions."),
    step("taper", "twice_weekly", taper.twice_weekly, "First estimate booked from their link."),
    step("plan", "plan", startDate, "Went through the 30-60-90 plan on day one."),
    step("culture", "culture", startDate),
    step("checkin", "fresh-eyes", daysAgo(today, 29), "Wants a short list of what we don't do, so they don't send the wrong jobs."),
    step("connect", "estimate", daysAgo(today, 25), "Watched one made on a call."),
    // Every check-in logged except the last few, so the page shows some to log.
    ...checkInsThrough(startDate, today, taper)
      .filter((c) => c.date < daysAgo(today, 3))
      .map((c) => step("checkin", c.key, c.date)),
    ...tasks.slice(0, 2).flatMap((t, i) => [
      step("training", trainingKey(t, "demonstrated"), daysAgo(today, 32 - i * 4)),
      step("training", trainingKey(t, "duplicated"), daysAgo(today, 30 - i * 4)),
      step("training", trainingKey(t, "released"), daysAgo(today, 27 - i * 4)),
    ]),
    ...(tasks[2] ? [step("training", trainingKey(tasks[2], "demonstrated"), daysAgo(today, 10))] : []),
    step("review", "30", daysAgo(today, 4), "Two clients booked from their link. Next: answer posts every evening."),
  ];
  return {
    id: SAMPLE_ID,
    name: "Morgan Sample",
    position: "affiliate",
    startDate,
    profileId: null,
    buddyName: "Riley Sample",
    ownsChecklists: false,
    today,
    steps,
    taughtOthers: 0,
    tasks,
  };
}
