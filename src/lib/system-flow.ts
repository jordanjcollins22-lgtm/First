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
        href: "/prep/demo",
        status: "live",
      },
      {
        key: "evaluation",
        title: "On-site evaluation",
        line: "The evaluator walks it with them and draws the site map.",
        href: "/operations?tab=evaluations",
        status: "live",
      },
      {
        key: "proposal",
        title: "Proposal",
        line: "The site map priced area by area, sent to accept and pay.",
        href: "/sales?tab=proposals",
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
        line: "What was sold, area by area, for the crew on the day.",
        href: "/operations?tab=jobs",
        status: "live",
      },
      {
        key: "field",
        title: "Crew in the field",
        line: "Photos of the work, and the tools checked onto the truck.",
        href: "/operations?tab=crew",
        status: "partly",
        gap: "The crew cannot log materials they buy yet.",
      },
      {
        key: "client-approval",
        title: "Client approves before & after",
        line: "The client gets the before and after on their phone and approves it.",
        href: null,
        status: "not-built",
        gap: "Photos go out on a watch link, but there is no approve button yet.",
      },
    ],
  },
];
