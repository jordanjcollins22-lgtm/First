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
  /** 15 the tasks training covers, each one documented, demonstrated, duplicated, then released */
  tasks: readonly TaskChecklist[];
}

/** 12 Culture: the same for everyone. Each value with an example of what it looks like here. */
export const CULTURE: readonly { value: string; looksLike: string }[] = [
  {
    value: "Leave it better than we found it",
    looksLike: "The crew blows off the driveway and the client's walkway before the after photo, even when nobody asked.",
  },
  {
    value: "Show up when we said we would",
    looksLike: "On the truck at 6:50, at the client's house in the window we gave them. Running late means a text before, not an apology after.",
  },
  {
    value: "Photos are the proof",
    looksLike: "No area is finished until its after photo is in the app. The photo is how the client, the office and the crew know it's done.",
  },
  {
    value: "Paid on results, so we work as a team",
    looksLike: "The crew shares the labor on every job, so the fastest person helps the slowest finish, and everyone takes home more.",
  },
  {
    value: "Learn it, teach it, build it",
    looksLike: "Once you can do a task alone you show the next new hire, and once you can teach it you help write the checklist so it teaches itself.",
  },
];

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
    problem: "Neighbors ask for yard work in local Facebook groups every day, and nobody from our company is there to answer.",
    achieve: [
      "A reply on every fresh post near us, with your link",
      "Booked evaluations and closed jobs from your link",
    ],
    avoid: [
      "Answering ads, posts outside our area, or people who already found someone",
      "Sounding like a salesperson instead of a neighbor",
    ],
    roles: ["Affiliate: answers local posts asking for yard work, paid 4% of every job that books through their link"],
    responsibilities: [
      "Answer new posts on Posts to Answer, freshest first",
      "Post our reply from your own Facebook account with your link",
      "Mark posts that aren't for us with Can't respond",
      "Share posts you find yourself",
    ],
    requirements: ["18 or older, allowed to work in the US", "A smartphone", "Lives in or near Harford County", "Active on Facebook"],
    results: ["Posts answered each week", "Clicks on your link", "Evaluations booked", "Jobs closed"],
    perfectDay: [
      { time: "Morning", what: "Open Posts to Answer and answer the newest posts first." },
      { time: "Lunch", what: "Check again for anything posted since the morning." },
      { time: "Evening", what: "Answer the last fresh posts and check how your answered posts are doing." },
    ],
    plan: [
      { day: 30, goal: "Answering posts every day, and your first evaluation booked from your link.", problem: "Get one client to book through your link." },
      { day: 60, goal: "Your first job closed from your link.", problem: "Find and share posts the app missed." },
      { day: 90, goal: "Steady jobs closed every month.", problem: "Show a new affiliate how you answer a post." },
    ],
    tasks: [
      {
        key: "answer-post",
        title: "Answer a post",
        steps: [
          "Open Posts to Answer and read what they need",
          "Check when it was posted: fresh posts first",
          "Change the comment if you like, then tap Use this comment",
          "Tap Copy & go to post and paste it as your own comment, then tap Next post",
        ],
      },
      {
        key: "cant-respond",
        title: "Skip a post that isn't for us",
        steps: ["Tap Can't respond", "Pick why: an ad, too far away, or they already found someone", "Move on to the next post"],
      },
      {
        key: "share-post",
        title: "Share a post you found",
        steps: ["On Facebook tap Share, then Copy link", "Paste it in the app", "Add a screenshot if you have one"],
      },
      {
        key: "follow-up",
        title: "Follow your posts",
        steps: ["Open Your answered posts", "See each one's status: No clicks yet, Clicked, Evaluation booked, Proposal sent, Closed"],
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
