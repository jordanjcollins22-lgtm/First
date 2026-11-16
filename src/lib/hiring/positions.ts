/**
 * The jobs we hire for, the questions each applicant answers, and what the
 * Indeed ad says. One place for all of it, so the ad, the form and the
 * screening can never disagree about what a role asks for.
 *
 * The screen is knockout questions only: a few yes-or-no facts that make the
 * job impossible (no licence for a driving job, can't lift a bag of mulch).
 * Everything else is for a person to read. Passing the screen asks for a
 * short video; nobody is hired by a form.
 */

export type PositionKey = "account-manager" | "evaluator" | "affiliate" | "project-technician" | "project-lead";

export type QuestionKind = "yesno" | "choice" | "text";

export interface Question {
  key: string;
  label: string;
  kind: QuestionKind;
  options?: readonly string[];
  /** Said under the question. */
  hint?: string;
  /** Answers that pass. A question with this set is a knockout. */
  passes?: readonly string[];
  /** What the applicant is told is missing, in our words, when it does not pass. Shown to us, never to them. */
  failReason?: string;
  optional?: boolean;
}

export interface Growth {
  stages: readonly string[];
  /** The last, optional stage: the move to the next job. */
  then: string;
}

export interface Position {
  key: PositionKey;
  title: string;
  /** One line for the careers page and the top of the ad. */
  tagline: string;
  /** The hourly pay. Null for a commission-only role, or until it is filled in; the ad says so and the admin page warns. */
  pay: string | null;
  /** Commission, said in the ad: set by the company's commission pool, or coming for the crew. */
  commission: string | null;
  /** Paid by commission alone, with no hourly pay: said plainly, so nobody applies expecting a wage. */
  commissionOnly: boolean;
  /**
   * The lowest and highest hourly pay, for Indeed's own pay fields (Maryland
   * job ads have to show a range). Kept apart from the ad's wording, which
   * leads with what a good week pays rather than the floor.
   */
  payRange?: readonly [number, number];
  /** What comes with the job besides pay. Maryland job ads must describe it. */
  benefits: readonly string[];
  /**
   * Where the job goes: its track on the Stages of Success, in order, and the
   * stage after the track. Said in the ad and on the careers page.
   */
  growth?: Growth;
  schedule: string;
  duties: readonly string[];
  lookingFor: readonly string[];
  questions: readonly Question[];
  /** What to say in the video, after who they are. */
  videoPrompt: string;
  /**
   * Interviews by phone or video call, never in person: a job done from
   * anywhere is hired from anywhere.
   */
  remoteInterviews?: boolean;
  /**
   * The skills step done from their phone, by link: one real situation they
   * answer in writing or with a recording. Set for a job with no crew or
   * desk to try out on.
   */
  skillsQuestion?: string;
  /**
   * Why we're not taking applications for it right now. When set, the job is
   * off the careers page and its apply form, but past applicants still show on
   * the hiring board under it.
   */
  closed?: string;
}

const YES = ["yes"] as const;

/** Asked of everyone, first. */
const BASICS: readonly Question[] = [
  { key: "age18", label: "Are you 18 or older?", kind: "yesno", passes: YES, failReason: "Under 18" },
  {
    key: "work_auth",
    label: "Are you legally allowed to work in the United States?",
    kind: "yesno",
    passes: YES,
    failReason: "Not authorized to work in the US",
  },
  {
    key: "smartphone",
    label: "Do you have a smartphone you can use for work (photos, maps, our app)?",
    kind: "yesno",
    passes: YES,
    failReason: "No smartphone",
  },
];

/** For anyone who drives to a property. */
const DRIVING: readonly Question[] = [
  { key: "license", label: "Do you have a valid driver's license?", kind: "yesno", passes: YES, failReason: "No driver's license" },
  {
    key: "transport",
    label: "Do you have reliable transportation to get to work every day?",
    kind: "yesno",
    passes: YES,
    failReason: "No reliable transportation",
  },
];

/** Asked of everyone, last. */
const ABOUT: readonly Question[] = [
  {
    key: "availability",
    label: "What are you looking for?",
    kind: "choice",
    options: ["Full time", "Part time", "Either"],
  },
  {
    key: "start",
    label: "When could you start?",
    kind: "choice",
    options: ["Right away", "Within 2 weeks", "Within a month", "Later than that"],
  },
  { key: "why", label: "Why do you want this job? A couple of sentences is plenty.", kind: "text" },
  {
    key: "heard",
    label: "Where did you hear about us?",
    kind: "choice",
    options: ["Indeed", "Facebook", "A friend or someone who works here", "Other"],
  },
];

/** The crew's share of each job's labor, split among the techs on it. */
export const CREW_SPLIT = 0.38;
/** Labor is budgeted at this much per tech-hour. */
export const LABOR_PER_TECH_HOUR = 95;
/** A tech never earns less than this an hour, whatever the split comes to: Maryland's minimum wage. */
export const TECH_FLOOR_PER_HOUR = 15;
/** What a tech earns an hour when a job comes in on budget: 38% of $95. */
export const TECH_ON_BUDGET_PER_HOUR = Math.round(CREW_SPLIT * LABOR_PER_TECH_HOUR);

export const POSITIONS: readonly Position[] = [
  {
    key: "project-technician",
    title: "Landscape Project Technician",
    tagline: "Turn tired yards into ones people stop to look at, on a crew that's paid on results. We teach you the trade, and the better your crew gets, the more you earn.",
    pay: `About $${TECH_ON_BUDGET_PER_HOUR} an hour when your crew finishes a job on budget, and more when you beat it`,
    commission: `Your crew shares ${Math.round(CREW_SPLIT * 100)}% of the labor on every job you finish, so a faster, sharper crew means a bigger paycheck. On a slow job you're still guaranteed at least $${TECH_FLOOR_PER_HOUR} an hour`,
    commissionOnly: false,
    payRange: [TECH_FLOOR_PER_HOUR, TECH_ON_BUDGET_PER_HOUR],
    benefits: [
      "Paid training from your first day",
      "Performance pay: the better your crew does the job, the more you take home",
      "Your own referral link: earn 4% of every job you bring in",
      "Crew hoodie, gloves, and eye and ear protection provided",
    ],
    growth: {
      stages: ["Learn", "Earn", "Shine", "Lead", "Train", "Profit"],
      then: "Mentor: guide new technicians, and move up to account manager when you're ready",
    },
    schedule: "Weekdays, starting around 7 AM. Some Saturdays in busy season.",
    duties: [
      "Bring yards back to life: clean up beds, pull weeds, edge, and lay fresh mulch and rock",
      "Plant shrubs and flowers, and seed and topsoil lawns",
      "Work with your crew from loading the truck to the final walkthrough",
      "Snap before and after photos in our app, so your work speaks for itself",
      "Leave every property cleaner than we found it",
    ],
    lookingFor: [
      "You show up on time, every time",
      "You like hard work outside and can lift 50 lb bags",
      "No experience needed: we teach you everything, and you're paid while you learn",
      "You treat clients and their homes with respect",
    ],
    questions: [
      ...BASICS,
      ...DRIVING,
      { key: "lift50", label: "Can you lift and carry 50 lb repeatedly through the day?", kind: "yesno", passes: YES, failReason: "Can't lift 50 lb" },
      { key: "outdoors", label: "Are you OK working outside in heat, cold and light rain?", kind: "yesno", passes: YES, failReason: "Won't work outdoors in all weather" },
      { key: "early", label: "Can you be at work by 7 AM?", kind: "yesno", passes: YES, failReason: "Can't start at 7 AM" },
      {
        key: "experience",
        label: "How much landscaping experience do you have?",
        kind: "choice",
        options: ["None, I'm ready to learn", "Less than a year", "1 to 3 years", "More than 3 years"],
      },
      ...ABOUT,
    ],
    videoPrompt: "Tell us about a time you worked hard on something physical, outdoors or otherwise, and what kept you going.",
  },
  {
    key: "project-lead",
    title: "Landscape Project Lead",
    tagline: "Run the crew on site: plan the day, do the work, and hand the client a finished job.",
    pay: "$30 an hour",
    commission: "commission on the jobs you complete, coming soon",
    commissionOnly: false,
    benefits: ["Paid training", "Performance bonuses"],
    schedule: "Weekdays, starting around 7 AM. Some Saturdays in busy season.",
    duties: [
      "Lead a small crew through each job from load-out to final walkthrough",
      "Follow the job plan in our app, area by area, with photos at each step",
      "Make sure the right tools and materials are on the truck",
      "Talk with clients on site, professionally, and flag anything that changes the job",
      "Train and look out for technicians",
    ],
    lookingFor: [
      "2+ years of landscaping or hardscaping experience",
      "Has led a crew or been the person others go to",
      "Can tow a trailer and keep a truck organized",
      "Calm, clear and professional with clients",
    ],
    questions: [
      ...BASICS,
      ...DRIVING,
      {
        key: "years",
        label: "How many years of landscaping or hardscaping experience do you have?",
        kind: "choice",
        options: ["Less than 1", "1 to 2", "2 to 5", "More than 5"],
        passes: ["2 to 5", "More than 5"],
        failReason: "Less than 2 years of landscaping experience",
      },
      { key: "led_crew", label: "Have you led a crew, or been in charge of other workers on a job?", kind: "yesno", passes: YES, failReason: "Hasn't led a crew" },
      { key: "trailer", label: "Can you tow and back up a trailer?", kind: "yesno", passes: YES, failReason: "Can't tow a trailer" },
      { key: "lift50", label: "Can you lift and carry 50 lb repeatedly through the day?", kind: "yesno", passes: YES, failReason: "Can't lift 50 lb" },
      { key: "early", label: "Can you be at work by 7 AM?", kind: "yesno", passes: YES, failReason: "Can't start at 7 AM" },
      ...ABOUT,
    ],
    videoPrompt: "A technician on your crew shows up 30 minutes late for the second time this week. Tell us what you do.",
    closed: "Removed Nov 14, 2026: we no longer have project leads.",
  },
  {
    key: "evaluator",
    title: "Landscape Evaluator",
    tagline: "Visit homeowners, walk the property with them, and map out the work in our app.",
    pay: null,
    commission: "4% commission on every job you evaluate that sells",
    commissionOnly: true,
    benefits: ["Flexible schedule", "Performance bonuses"],
    schedule: "Flexible. Visits are booked in time slots during the day, some evenings and Saturdays.",
    duties: [
      "Meet homeowners at their property and walk it with them",
      "Map each area on the site map in our app, measure it and take photos",
      "Listen for what the client really wants and note it clearly",
      "Hand a complete evaluation to the account manager the same day",
    ],
    lookingFor: [
      "Friendly and confident meeting people at their front door",
      "Careful with details: measurements, photos and notes",
      "Comfortable using an app on your phone",
      "Landscaping knowledge is a plus. We train on the rest",
      "Commission only: you're paid on the jobs you evaluate that sell, not hours",
    ],
    questions: [
      ...BASICS,
      ...DRIVING,
      {
        key: "commission_only",
        label: "This is commission only: 4% of every job you evaluate that sells, with no hourly pay. Is that OK with you?",
        kind: "yesno",
        passes: YES,
        failReason: "Doesn't want commission-only pay",
      },
      { key: "walk", label: "Are you OK walking properties and measuring yards in all weather?", kind: "yesno", passes: YES, failReason: "Won't walk properties" },
      { key: "people", label: "Are you comfortable meeting and talking with homeowners you don't know?", kind: "yesno", passes: YES, failReason: "Not comfortable meeting homeowners" },
      {
        key: "knowledge",
        label: "How much do you know about landscaping?",
        kind: "choice",
        options: ["Not much yet", "Some, from my own yard", "I've worked in landscaping", "A lot, professionally"],
      },
      ...ABOUT,
    ],
    videoPrompt: "Pretend you've just knocked on a homeowner's door for their evaluation. Introduce yourself and the visit, as you would to them.",
    closed: "Removed Nov 14, 2026: estimates are free satellite breakdowns from Harford County GIS, and paid site visits go to the account manager.",
  },
  {
    key: "account-manager",
    title: "Account Manager",
    tagline: "Be the person who makes a growing landscaping location run: the team, the schedule and every client. You earn on every job your location finishes.",
    pay: null,
    commission: "7% commission on every job your location completes",
    commissionOnly: true,
    benefits: [
      "Paid training on our app and how we run a location",
      "Performance bonuses",
      "Your income grows with your location: every job it finishes pays you",
      "Your own referral link: earn 4% of every job you bring in",
    ],
    growth: {
      stages: ["Learn", "Hire", "Crush the rush", "Offseason", "Consistency", "Mentor"],
      then: "Partner: run your own JS Landscaping location, at no cost to start",
    },
    schedule: "Weekdays, from the office, your phone and on site. Longer weeks in busy season.",
    duties: [
      "Keep every client happy: approve or tweak the replies our AI front desk writes for you",
      "Run the schedule for every crew so jobs land on their day",
      "Handle invoices, estimate requests and paid site visits",
      "Build the team: recruit, onboard and keep great people",
      "Review the weekly scorecard with the owner and steer the location",
    ],
    lookingFor: [
      "Experience in customer service, an office, or running a crew",
      "Organized: nothing falls through the cracks",
      "A clear, friendly writer for texts and emails",
      "Comfortable leading people and having the hard conversation",
      "Paid on results: you earn 7% of every job your location completes, not hours",
    ],
    questions: [
      ...BASICS,
      ...DRIVING,
      {
        key: "sales",
        label: "How much customer service, office or management experience do you have?",
        kind: "choice",
        options: ["None", "Less than a year", "1 to 3 years", "More than 3 years"],
      },
      { key: "calls", label: "Are you comfortable calling and texting clients and crew every day?", kind: "yesno", passes: YES, failReason: "Not comfortable calling clients and crew" },
      { key: "computer", label: "Are you comfortable working in an app and on a computer much of the day?", kind: "yesno", passes: YES, failReason: "Not comfortable with computer work" },
      {
        key: "commission_ok",
        label: "This is commission only: 7% of every job your location completes, with no hourly pay. Is that OK with you?",
        kind: "yesno",
        passes: YES,
        failReason: "Doesn't want commission-only pay",
      },
      ...ABOUT,
    ],
    videoPrompt: "A client texts that the crew left a mess and they're upset. Tell us what you'd do in the next hour, start to finish.",
  },
  {
    key: "affiliate",
    title: "Affiliate",
    tagline: "Get paid for every client you send us: the neighbor next door, a friend, a coworker, someone asking online. Anyone who needs yard work, and every job that books through your link pays you.",
    pay: null,
    commission: "4% commission on every job that books through your link",
    commissionOnly: true,
    benefits: [
      "Flexible schedule: any time, from anywhere",
      "Performance bonuses",
      "No hard selling: share your link, and we handle the estimate, the job and the follow-up",
      "Ready-made replies for people asking online, so you never start from scratch",
    ],
    growth: {
      stages: ["Join", "First job", "Five", "Shine", "Steady", "$10K"],
      then: "Move up: join the crew as a project technician",
    },
    schedule: "Any time, anywhere. As many or as few hours as you like.",
    duties: [
      "Send us anyone who needs yard work: neighbors, friends, family, coworkers, people you meet",
      "Share your own link so every job they book counts for you",
      "Answer people asking for yard work online, with replies we write for you",
      "Watch in our app as the people you sent turn into booked jobs",
    ],
    lookingFor: [
      "Knows a lot of people, in person or online",
      "Lives in or near Harford County, Maryland",
      "Friendly and genuine, never pushy",
      "No experience needed: we train you step by step, and our app writes the replies for you",
      "Paid on results: 4% of every job that books through your link, not hours",
    ],
    questions: [
      ...BASICS,
      {
        key: "commission_only",
        label: "This is commission only: 4% of every job that books through your link, with no hourly pay. Is that OK with you?",
        kind: "yesno",
        passes: YES,
        failReason: "Doesn't want commission-only pay",
      },
      { key: "local", label: "Do you live in or near Harford County, Maryland?", kind: "yesno", passes: YES, failReason: "Not local to Harford County" },
      { key: "facebook", label: "Do you know a lot of people around here, in person or online (neighbors, friends, local Facebook groups)?", kind: "yesno" },
      ...ABOUT.filter((q) => q.key !== "availability"),
    ],
    videoPrompt: "Tell us a bit about yourself: who you know around here, and why you'd be good at sending people our way.",
    remoteInterviews: true,
    skillsQuestion: "Your neighbor says their yard is a mess and they don't know who to call. Write (or record) what you'd say.",
  },
];

export function positionFor(key: string): Position | null {
  return POSITIONS.find((p) => p.key === key) ?? null;
}

/** The jobs we're taking applications for: what the careers page lists and the apply form accepts. */
export const OPEN_POSITIONS: readonly Position[] = POSITIONS.filter((p) => !p.closed);

/** A job someone can apply for now, or null when it's unknown or closed. */
export function openPositionFor(key: string): Position | null {
  const p = positionFor(key);
  return p && !p.closed ? p : null;
}

/** How we meet an applicant for interviews, said the way an applicant reads it. */
export function interviewKind(position: Pick<Position, "remoteInterviews"> | null | undefined): string {
  return position?.remoteInterviews ? "a phone or video interview" : "an in-person interview";
}
