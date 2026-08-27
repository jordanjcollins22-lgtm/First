/**
 * Screens a node can point at.
 *
 * A node that says "flyers" and a page that builds the flyer are the same
 * thing thought about twice. This is the list of places in the app a node can
 * open, so the graph stops being a description of the business and starts
 * being a way into it.
 *
 * A fixed list rather than a free text field: a typed route rots the first
 * time a page moves, and a node whose link 404s is worse than a node with no
 * link on it.
 */

export interface AppDestination {
  route: string;
  label: string;
  /** What pressing it actually gets you. */
  description: string;
}

export const APP_DESTINATIONS: readonly AppDestination[] = [
  {
    route: "/admin/social",
    label: "Before & after posts",
    description: "The queue of before-and-afters made from crew photos.",
  },
  {
    route: "/admin/flyer",
    label: "Flyer design",
    description: "The EDDM flyer and the seven ad squares on it.",
  },
  {
    route: "/admin/labels",
    label: "Labels & codes",
    description: "QR stickers for stock, and the printable sheet.",
  },
  {
    route: "/admin/tools",
    label: "Inventory",
    description: "Tools, gear, materials and marketing stock.",
  },
  { route: "/leads", label: "Lead generation", description: "Where new work comes from." },
  { route: "/pipeline", label: "Pipeline", description: "Work in flight." },
  { route: "/proposals", label: "Proposals", description: "Quotes out with customers." },
  { route: "/admin/payments", label: "Money", description: "What came in and what went out." },
  { route: "/evaluations", label: "Calendar", description: "What is booked." },
];

const BY_ROUTE = new Map(APP_DESTINATIONS.map((d) => [d.route, d]));

export function destinationFor(route: string | null | undefined): AppDestination | null {
  if (!route) return null;
  return BY_ROUTE.get(route) ?? null;
}

/**
 * A guess at where a node belongs, from what it is called.
 *
 * Only ever a suggestion — it fills the picker in, it does not decide. The
 * matches are deliberately narrow: linking a node to the wrong screen is a
 * worse outcome than linking nothing at all.
 */
export function suggestDestination(title: string, nodeType?: string): AppDestination | null {
  const text = title.toLowerCase();

  if (/\b(flyer|flier|eddm|door hanger|mailer)\b/.test(text)) {
    return destinationFor("/admin/flyer");
  }
  if (/\b(social|facebook|instagram|before and after|before\/after|post)\b/.test(text)) {
    return destinationFor("/admin/social");
  }
  if (/\b(qr|label|barcode|sticker)\b/.test(text)) {
    return destinationFor("/admin/labels");
  }
  if (/\b(inventory|stock|supplies)\b/.test(text)) {
    return destinationFor("/admin/tools");
  }
  if (nodeType === "marketing_channel" && /\b(lead|referral|door knock)\b/.test(text)) {
    return destinationFor("/leads");
  }

  return null;
}

/**
 * Only a route we actually have.
 *
 * Anything else becomes null rather than being stored: the whole reason this
 * is a list and not a text box is that a link which 404s is worse than no
 * link, and the check belongs where the write happens.
 */
export function safeAppRoute(value: string | null | undefined): string | null {
  if (!value) return null;
  return BY_ROUTE.has(value) ? value : null;
}
