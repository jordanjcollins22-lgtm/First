import type { PositionKey } from "@/lib/hiring/positions";

/**
 * The written side of each job, from the hiring structure:
 *
 * - 0.1 the role: the problem this hire solves, what they should achieve, what they should avoid
 * - 0.4 the Four Rs (roles, responsibilities, requirements, results) and a perfect day
 * - 11 the 30-60-90 day plan, with a problem to solve at each milestone
 * - 12 culture: how we think, each value with a real example
 * - 15 the task checklists training runs on
 *
 * Drafted from what the owner has decided so far (pay, duties, the app's
 * screens). Every line is meant to be read and changed by the owner: it is
 * a first draft, not policy.
 */

export interface TaskChecklist {
  key: string;
  title: string;
  /** Written so a stranger could follow it. */
  steps: readonly string[];
}

export interface RoleDoc {
  position: PositionKey;
  /** 0.1 */
  problem: string;
  achieve: readonly string[];
  avoid: readonly string[];
  /** 0.4 Four Rs */
  roles: readonly string[];
  responsibilities: readonly string[];
  requirements: readonly string[];
  results: readonly string[];
  /** 0.4 perfect day, in order */
  perfectDay: readonly { time: string; what: string }[];
  /** 11 Clarity: day 30, 60 and 90, each with the problem they should be solving by then */
  plan: readonly { day: 30 | 60 | 90; goal: string; problem: string }[];
  /** 11 Clarity: the planned first one to two weeks, day by day */
  firstTwoWeeks?: readonly { when: string; what: string }[];
  /** 13 Connection: time seeing other parts of the business, each one logged when done */
  seeTheBusiness?: readonly { key: string; what: string }[];
  /** Hired and trained from anywhere: check-ins by phone or video call, training over a call or screen share. */
  remote?: boolean;
  /** 15 the tasks training covers, each one documented, demonstrated, duplicated, then released */
  tasks: readonly TaskChecklist[];
}

/** 12 Culture: the same for everyone. Each value with an example of what it looks like here. */
type CultureRole = "project-technician" | "affiliate" | "account-manager";

export interface CultureValue {
  value: string;
  /** What it looks like in each job. A job with no example of its own shows the technician's. */
  looksLike: { "project-technician": string } & Partial<Record<CultureRole, string>>;
}

/** The five values, the same for every job, each with an example for that job. */
export const CULTURE: readonly CultureValue[] = [
  {
    value: "Leave it better than we found it",
    looksLike: {
      "project-technician": "The crew blows off the driveway and the client's walkway before the after photo, even when nobody asked.",
      affiliate: "Only send people we can really help, and check in after their job to make sure they're happy they asked you.",
    },
  },
  {
    value: "Show up when we said we would",
    looksLike: {
      "project-technician": "On the truck at 6:50, at the client's house in the window we gave them. Running late means a text before, not an apology after.",
      affiliate: "If you tell someone we'll reach out today, get their info to us today. Answer people asking online the same day they post.",
    },
  },
  {
    value: "Photos are the proof",
    looksLike: {
      "project-technician": "No area is finished until its after photo is in the app. The photo is how the client, the office and the crew know it's done.",
      affiliate: "Show people our real before and after photos instead of making promises, and let the work sell itself.",
    },
  },
  {
    value: "Paid on results, so we work as a team",
    looksLike: {
      "project-technician": "The crew shares the labor on every job, so the fastest person helps the slowest finish, and everyone takes home more.",
      affiliate: "You earn when the job closes, so pass along everything you know (what they want, when, and the best way to reach them) so the account manager can close it.",
    },
  },
  {
    value: "Learn it, teach it, build it",
    looksLike: {
      "project-technician": "Once you can do a task alone you show the next new hire, and once you can teach it you help write the checklist so it teaches itself.",
      affiliate: "Once you're steady, show a new affiliate how you find people and what you say to them.",
    },
  },
];

/** The values with this job's example of each. */
export function cultureFor(position: string | null | undefined): { value: string; looksLike: string }[] {
  return CULTURE.map((c) => ({
    value: c.value,
    looksLike: (position && c.looksLike[position as CultureRole]) || c.looksLike["project-technician"],
  }));
}

export const ROLE_DOCS: Record<"project-technician" | "affiliate" | "account-manager", RoleDoc> = {
  "project-technician": {
    position: "project-technician",
    problem: "Signed jobs need to be done right, on budget and on the day we promised, without the owner on site.",
    achieve: [
      "Every area finished to the plan, with its after photo in the app",
      "Jobs finished at or under the hours they were budgeted",
      "Clients who would hire us again and tell a neighbor",
    ],
    avoid: [
      "Leaving a mess, or damage nobody reported",
      "Starting an area before its prep photo is in",
      "Showing up late or without the right tools",
    ],
    roles: ["Project technician on a two-person crew, working the job sheet in our app"],
    responsibilities: [
      "Load the truck from the crew sheet's kit list",
      "Prep each area and take its prep photo before any install",
      "Do the work area by area, and take the after photo when each is done",
      "Keep tools clean and the truck organized",
      "Treat the client and their property with respect",
    ],
    requirements: [
      "18 or older, allowed to work in the US",
      "Driver's license and reliable transportation",
      "Can lift 50 lb repeatedly and work outside in all weather",
      "At the shop by 6:50 AM",
      "A smartphone for the app",
    ],
    results: [
      "Jobs finished on budget (hours worked vs hours budgeted)",
      "Every area with a prep photo and an after photo",
      "No callbacks or complaints",
      "On time every day",
    ],
    perfectDay: [
      { time: "6:50 AM", what: "At the shop. Open today's crew sheet in the app." },
      { time: "7:00 AM", what: "Load the truck from the kit list and head out." },
      { time: "On site", what: "Walk the job with your crew. Prep each area and take its prep photo." },
      { time: "All day", what: "Work area by area. After photo when each area is done." },
      { time: "Finish", what: "Clean up, blow off hard surfaces, final walkthrough with the after photos." },
      { time: "End of day", what: "Back at the shop, unload, clean tools, ready for tomorrow." },
    ],
    plan: [
      { day: 30, goal: "Released on the core ground tasks: cleanups, mulch and edging.", problem: "Finish your share of a mulch job without being corrected." },
      { day: 60, goal: "Released on planting and lawn work, and keeping pace with the crew budget.", problem: "Help your crew finish two jobs in a row on budget." },
      { day: 90, goal: "Working fully on your own, and ready to show the next new tech one task.", problem: "Demonstrate one task to a new hire using its checklist." },
    ],
    tasks: [
      {
        key: "load-out",
        title: "Load the truck",
        steps: [
          "Open today's job in the app and go to the crew sheet",
          "Load every tool on the kit list and tick it",
          "Load the materials and check the amounts against the sheet",
          "Strap everything down and check the trailer lights",
        ],
      },
      {
        key: "bed-cleanup",
        title: "Bed cleanup and edging",
        steps: [
          "Take the area's prep photo before touching anything",
          "Pull weeds by the root and rake out old debris",
          "Cut a clean edge along every bed line",
          "Blow off hard surfaces and take the after photo",
        ],
      },
      {
        key: "mulch",
        title: "Mulch and rock",
        steps: [
          "Check the depth and amount on the crew sheet",
          "Spread evenly, keeping mulch off trunks and siding",
          "Rake smooth and tuck it in at the edges",
          "Blow off hard surfaces and take the after photo",
        ],
      },
      {
        key: "planting",
        title: "Planting",
        steps: [
          "Place every plant where the plan shows before digging",
          "Dig twice as wide as the root ball and loosen the roots",
          "Set the plant at grade, backfill and water in",
          "Mulch around it and take the after photo",
        ],
      },
      {
        key: "lawn",
        title: "Seeding and topsoil",
        steps: [
          "Rake out the area and spread topsoil to the depth on the sheet",
          "Spread seed at the rate on the sheet",
          "Lightly rake in, then water",
          "Take the after photo",
        ],
      },
      {
        key: "walkthrough",
        title: "Final walkthrough",
        steps: [
          "Check every area has its after photo in the app",
          "Walk the property for anything left behind",
          "Blow off driveways and walkways",
          "Mark the job finished in the app",
        ],
      },
    ],
  },
  affiliate: {
    position: "affiliate",
    problem: "People all around us need yard work, from the neighbor next door to friends online, and they don't know a company they can trust.",
    achieve: [
      "Jobs booked and closed through your link, from anyone you know or meet",
      "Booked estimates from the people you send us",
      "Clients who are glad you sent them, and tell others",
    ],
    avoid: [
      "Sounding like a salesperson instead of a neighbor",
      "Promising a price or a date: the estimate does that",
      "Answering ads, posts outside our area, or people who already found someone",
    ],
    roles: ["Affiliate: sends us anyone who needs yard work, in person or online, paid 4% of every job that books through their link"],
    responsibilities: [
      "Tell the people you know what we do, and share your link with anyone who needs yard work",
      "Find people asking for yard work online, and send them your link with a screenshot of their post",
      "Follow up kindly with anyone who clicked but hasn't booked",
    ],
    requirements: ["18 or older, allowed to work in the US", "A smartphone", "Lives in or near Harford County", "Knows a lot of people, in person or online"],
    results: ["People you sent us", "Estimates booked", "Jobs closed", "Clicks on your link"],
    perfectDay: [
      { time: "Morning", what: "Look for people asking for yard work in local groups and online, and send them your link." },
      { time: "During the day", what: "Mention us to anyone who talks about their yard: a neighbor, a coworker, a friend. Text them your link." },
      { time: "Evening", what: "Answer anyone new asking online, and check how far the people you sent got." },
    ],
    plan: [
      { day: 30, goal: "Your link shared with the people you know, and your first estimate booked from it.", problem: "Get one person you know to book an estimate through your link." },
      { day: 60, goal: "Your first job closed from your link.", problem: "Find more people who need yard work: neighbors, friends, posts you see online." },
      { day: 90, goal: "Steady jobs closed every month, from people you know and people online.", problem: "Show a new affiliate how you bring someone in." },
    ],
    remote: true,
    firstTwoWeeks: [
      { when: "Day 1", what: "Video call with Jordan: get your link, a tour of the app, your 30-60-90 plan and our values. Meet another affiliate, if we have one yet." },
      { when: "Day 2", what: "Learn what we do: go through our services and our before and after photos, so you can tell people what we do." },
      { when: "Day 3", what: "Send us someone you know, from the first task checklist, on a call with another affiliate if we have one yet." },
      { when: "Day 4", what: "Answer your first post online: send your link with Someone online and a screenshot, with another affiliate watching on a screen share if we have one yet." },
      { when: "Day 5", what: "Fresh-eyes call: what confused you this week, and what would you fix?" },
      { when: "Week 2", what: "Share your link and answer people asking online every day on your own. Check in by phone or video call each morning and evening. Aim: your first estimate booked from your link." },
    ],
    seeTheBusiness: [
      { key: "estimate", what: "Listen in on a paid site visit or estimate call the account manager runs (by phone or video), so you know what the people you send will get." },
      { key: "finished-job", what: "Go through a finished job's before and after photos with a technician, and hear what made it go well." },
      { key: "booked-to-done", what: "Follow one client from booked estimate to finished job in the app." },
    ],
    tasks: [
      {
        key: "share-link",
        title: "Send us someone you know",
        steps: [
          "At the top of your app, tap Send my link to someone and type who it's for",
          "Pick how you know them, then add a screenshot of who you're answering if you have one",
          "Tap Submit, then Copy message and send it to them",
          "Check People you sent it to for how far they got",
        ],
      },
      {
        key: "answer-post",
        title: "Answer someone asking online",
        steps: [
          "Find someone asking for yard work in a local group or online, and read what they need",
          "Take a screenshot of their post",
          "Tap Send my link to someone, type their name and pick Someone online",
          "Add the screenshot, tap Submit, then copy the message and send it to them",
        ],
      },
      {
        key: "cant-respond",
        title: "Skip a post that isn't for us",
        steps: ["Skip ads, posts outside Harford County, and people who already found someone", "Move on to the next one"],
      },
      {
        key: "follow-up",
        title: "Follow the people you sent",
        steps: ["Open People you sent it to", "See how far each one got: sent, opened, booked or sold", "Follow up kindly with anyone who opened it but hasn't booked an estimate"],
      },
    ],
  },
  "account-manager": {
    position: "account-manager",
    problem: "The location needs one person who keeps clients happy, crews scheduled and the team growing, so the owner doesn't have to.",
    achieve: [
      "Every client message answered the same day",
      "Every crew scheduled a week ahead, with jobs on their day",
      "Invoices out and paid",
      "The team staffed and trained",
    ],
    avoid: [
      "Client messages left waiting overnight",
      "Jobs moved without telling the client",
      "Hiring someone without the full hiring steps",
    ],
    roles: ["Account manager: runs the location as its general manager, paid 7% of every job the location completes"],
    responsibilities: [
      "Approve or edit the AI front desk's replies",
      "Run the crew schedule",
      "Handle invoices, estimate requests and paid site visits",
      "Recruit, onboard and train the team",
      "Review the weekly scorecard with the owner",
    ],
    requirements: [
      "18 or older, allowed to work in the US",
      "Driver's license and reliable transportation",
      "A smartphone and comfortable on a computer",
      "Customer service, office or crew management experience",
    ],
    results: ["Response time to clients", "Jobs finished on their scheduled day", "Revenue completed by the location", "Team retention"],
    perfectDay: [
      { time: "7:00 AM", what: "Check today's crews are out and on their jobs." },
      { time: "Morning", what: "Clear the front desk: approve or edit every drafted reply." },
      { time: "Midday", what: "Paid site visits and estimate requests." },
      { time: "Afternoon", what: "Schedule next week, send invoices, follow up on what's owed." },
      { time: "End of day", what: "Check-ins with new hires, then the scorecard." },
    ],
    plan: [
      { day: 30, goal: "Running the front desk and the schedule on your own.", problem: "Get every client reply out the same day for a full week." },
      { day: 60, goal: "Handling invoices, paid site visits and estimates.", problem: "Bring overdue invoices to zero." },
      { day: 90, goal: "Recruiting and onboarding the next hire yourself.", problem: "Run one new hire through the hiring steps start to finish." },
    ],
    tasks: [
      {
        key: "front-desk",
        title: "Clear the front desk",
        steps: ["Open the messages waiting for approval", "Read each drafted reply against the client's message", "Edit anything that's off, then approve", "Anything the AI can't answer, call the client"],
      },
      {
        key: "schedule",
        title: "Schedule the crews",
        steps: ["Open next week's schedule", "Put each signed job on a day with a crew", "Check the weather and move what has to move", "Tell every client their day"],
      },
      {
        key: "price-proposal",
        title: "Price a job and send the proposal",
        steps: ["Open the job on My Day", "Check the price against what's behind it", "Accept the price, review the proposal", "Send it to the client"],
      },
      {
        key: "invoice",
        title: "Invoice a finished job",
        steps: ["Check every area has its after photo", "Send the invoice from the job", "Follow up on anything unpaid after 7 days"],
      },
    ],
  },
};

export type DocPosition = keyof typeof ROLE_DOCS;

export function roleDocFor(position: string | null | undefined): RoleDoc | null {
  return position && position in ROLE_DOCS ? ROLE_DOCS[position as DocPosition] : null;
}
