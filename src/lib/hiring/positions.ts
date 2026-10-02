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

export interface Position {
  key: PositionKey;
  title: string;
  /** One line for the careers page and the top of the ad. */
  tagline: string;
  /** How the role is paid. Null until it is filled in; the ad says so and the admin page warns. */
  pay: string | null;
  /** Commission that is already set by the company's commission pool, said in the ad. */
  commission: string | null;
  schedule: string;
  duties: readonly string[];
  lookingFor: readonly string[];
  questions: readonly Question[];
  /** What to say in the video, after who they are. */
  videoPrompt: string;
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

export const POSITIONS: readonly Position[] = [
  {
    key: "project-technician",
    title: "Landscape Project Technician",
    tagline: "Hands-on landscaping work: bed cleanups, mulch, planting, lawn work and installs.",
    pay: null,
    commission: null,
    schedule: "Weekdays, starting around 7 AM. Some Saturdays in busy season.",
    duties: [
      "Clean up beds, pull weeds, edge, and lay mulch and rock",
      "Plant shrubs and flowers, seed and topsoil lawns",
      "Load and unload tools and materials, and keep them clean and organized",
      "Take before and after photos on the job in our app",
      "Leave every property cleaner than we found it",
    ],
    lookingFor: [
      "Shows up on time, every time",
      "Can lift 50 lb bags and work outside in heat and cold",
      "Landscaping experience is a plus, not required. We train",
      "Respectful with clients and their property",
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
    pay: null,
    commission: null,
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
  },
  {
    key: "evaluator",
    title: "Landscape Evaluator",
    tagline: "Visit homeowners, walk the property with them, and map out the work in our app.",
    pay: null,
    commission: "4% commission on every job you evaluate that sells",
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
    ],
    questions: [
      ...BASICS,
      ...DRIVING,
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
  },
  {
    key: "account-manager",
    title: "Account Manager (Sales)",
    tagline: "Own the client from first visit to finished job: send proposals, follow up and close.",
    pay: null,
    commission: "7% commission on every job you close",
    schedule: "Weekdays, mostly from your phone and computer. Some site visits.",
    duties: [
      "Price evaluations and send proposals from our app",
      "Call and follow up with every client until they decide",
      "Keep each client updated from signed proposal to finished job",
      "Approve before and after photos and close out the job",
    ],
    lookingFor: [
      "Sales or customer service experience",
      "Makes the follow-up call every time, and enjoys it",
      "Organized: nothing falls through the cracks",
      "Clear, friendly writer for texts and emails",
    ],
    questions: [
      ...BASICS,
      {
        key: "sales",
        label: "How much sales or customer service experience do you have?",
        kind: "choice",
        options: ["None", "Less than a year", "1 to 3 years", "More than 3 years"],
      },
      { key: "calls", label: "Are you comfortable making follow-up phone calls to clients every day?", kind: "yesno", passes: YES, failReason: "Not comfortable making calls" },
      {
        key: "commission_ok",
        label: "Part of this role's pay is 7% commission on the jobs you close. Is that OK with you?",
        kind: "yesno",
        passes: YES,
        failReason: "Doesn't want commission pay",
      },
      { key: "computer", label: "Are you comfortable working in an app and on a computer all day?", kind: "yesno", passes: YES, failReason: "Not comfortable with computer work" },
      ...ABOUT,
    ],
    videoPrompt: "Pretend you're calling a homeowner who got their proposal three days ago and hasn't answered. Leave us that voicemail.",
  },
  {
    key: "affiliate",
    title: "Affiliate (Commission Only)",
    tagline: "Help neighbors who are asking for yard work find us online, and earn on every job that books.",
    pay: null,
    commission: "4% commission on every job that books through your link",
    schedule: "Work from your phone, any time. As many or as few hours as you like.",
    duties: [
      "Answer local Facebook posts from people asking for yard work, using comments we write for you",
      "Share your own link so jobs are counted for you",
      "Track every post you answered and how it went in our app",
    ],
    lookingFor: [
      "Active on Facebook and in local community groups",
      "Lives in or near Harford County, Maryland",
      "Friendly and genuine online",
      "Commission only: you're paid on jobs, not hours",
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
      { key: "facebook", label: "Are you active on Facebook and in local community groups?", kind: "yesno" },
      ...ABOUT.filter((q) => q.key !== "availability"),
    ],
    videoPrompt: "Someone in a local Facebook group asks, \"Anyone know a good landscaper?\" Tell us what you'd write back, and why.",
  },
];

export function positionFor(key: string): Position | null {
  return POSITIONS.find((p) => p.key === key) ?? null;
}
