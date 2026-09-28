/**
 * The whole business on one screen, in the order a customer moves through it.
 *
 * Marketing brings them in, one square per system. Then the line every job
 * follows: they book the evaluation, fill in the form before it, the
 * evaluator walks the property and draws the site map, that becomes the
 * proposal, the proposal becomes the crew's sheet, the crew does the work and
 * records it, and the client sees the before and after.
 *
 * Each square says what the system does in a line and opens where it is run.
 * The status is honest: a square for something only half built says so, and
 * one for something not built yet says that, rather than linking to a page
 * that does not do it.
 *
 * Plain data, so the order and the links are checked by a test.
 */

export type SystemStatus = "live" | "partly" | "not-built";

export interface SystemSquare {
  key: string;
  title: string;
  /** One line: what it does. */
  line: string;
  /** Where it is run or seen. Null when there is nowhere yet. */
  href: string | null;
  status: SystemStatus;
  /** What is missing, when it is not all live. */
  gap?: string;
}

export interface SystemStage {
  key: string;
  title: string;
  squares: SystemSquare[];
}

export const STATUS_LABEL: Record<SystemStatus, string> = {
  live: "Live",
  partly: "Partly built",
  "not-built": "Not built yet",
};

export const SYSTEM_FLOW: SystemStage[] = [
  {
    key: "marketing",
    title: "Marketing: where they come from",
    squares: [
      {
        key: "comments",
        title: "Comment automation",
        line: "Finds posts asking for the work and writes the comment with a tracked link.",
        href: "/admin/outreach/posts",
        status: "live",
      },
      {
        key: "social",
        title: "Before & after posts",
        line: "Turns the crew's job photos into posts you approve.",
        href: "/marketing?tab=content",
        status: "live",
      },
      {
        key: "print",
        title: "Door hangers & flyers",
        line: "The door hanger and the flyer, laid out ready to print.",
        href: "/marketing?tab=print",
        status: "live",
      },
      {
        key: "sign",
        title: "Neighbourhood sign",
        line: "The frame sign that goes up while a crew is on the street.",
        href: "/admin/marketing/poster",
        status: "live",
      },
      {
        key: "email",
        title: "Email campaigns",
        line: "One offer to the list, sent a little at a time.",
        href: "/admin/campaigns",
        status: "live",
      },
      {
        key: "groups",
        title: "Local groups",
        line: "The neighbourhood groups we run, and who paid to advertise.",
        href: "/admin/groups",
        status: "live",
      },
      {
        key: "map",
        title: "Map & mailers",
        line: "The houses, zones and mail routes worth going after.",
        href: "/marketing?tab=map",
        status: "live",
      },
    ],
  },
  {
    key: "win",
    title: "Booking to proposal",
    squares: [
      {
        key: "booking",
        title: "Evaluation booking",
        line: "The page they land on from a comment or code, and book a time.",
        href: "/admin/booking-page",
        status: "live",
      },
      {
        key: "prep",
        title: "Pre-evaluation form",
        line: "One question at a time after they book: the work, photos, concerns.",
        // Every page side by side; the click-through demo is linked from it.
        href: "/practice/pre-evaluation",
        status: "live",
      },
      {
        key: "evaluation",
        title: "Evaluation site map",
        line: "The evaluator's visit: On my way, I've arrived, Start, the site map from the pre-eval, Walkthrough complete.",
        // Every page of the visit in preview. The tool alone is at /practice/site-map.
        href: "/practice/evaluator",
        status: "live",
      },
      {
        key: "pricing",
        title: "Price and proposal",
        line: "Each submitted walkthrough on the account manager's My Day: the breakdown, Accept price, Review proposal, Send to client.",
        // Every page of it in preview. Nothing is priced or sent.
        href: "/practice/account-manager",
        status: "live",
      },
    ],
  },
  {
    key: "work",
    title: "Crew sheet to finished work",
    squares: [
      {
        key: "crew-sheet",
        title: "Crew sheet",
        line: "Everything on site, for our crew or a subcontractor: the shop and the kits with their codes, On my way, every area prepped with its photo, then the install area by area, receipts for anything bought.",
        // Every page of it for both, in preview. The live board is /operations?tab=crew.
        href: "/practice/crew",
        status: "live",
      },
      {
        key: "client-approval",
        title: "Client approves before & after",
        line: "The account manager sends the befores and afters; the client approves from their phone, then the job is signed off.",
        // Done from each project's Sign-off card, so there is no one page for it.
        href: null,
        status: "live",
      },
      {
        key: "project-review",
        title: "Project review",
        line: "Every project scored live, green or red: issues (each put right and changed so it can't happen again), hours and cost against budget, a five-star review, a referral, and profit.",
        href: "/jobs/review",
        status: "live",
      },
    ],
  },
];
