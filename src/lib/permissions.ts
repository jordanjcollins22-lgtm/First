/**
 * The list of pages the Permissions screen governs.
 *
 * This is the single source of truth: adding an entry here puts the page in
 * the nav *and* gives it a column on the permissions matrix, so a new page can
 * never quietly ship ungoverned. `src/lib/permissions.test.ts` walks the app
 * directory and fails if a route exists that is neither registered here nor
 * listed as exempt below — that's what makes it automatic rather than
 * something someone has to remember.
 */

export interface TabDefinition {
  key: string;
  /**
   * What this page is called, everywhere.
   *
   * The permissions matrix, the sidebar and the page's own heading all read
   * this, so they cannot drift. Labels used to carry a parenthetical saying
   * where a page lived, like "Proposals (Pipeline tab)", which meant the
   * permission and the page it governed were called different things and
   * somebody ticking a box had to work out which page they had just opened.
   */
  label: string;
  href: string;
  /**
   * The tab whose page this one is reached through, when it is a tab on
   * another page rather than a destination of its own.
   *
   * Ticking a permission is meant to grant access. It did not, quite: a role
   * given Contacts but not Project Data had no way to reach Contacts at all,
   * because the only door to it was a page they could not open. So a tab with
   * a parent the viewer cannot see gets its own place in the sidebar.
   */
  parent?: string;
}

export const TABS: readonly TabDefinition[] = [
  { key: "dashboard", label: "Dashboard", href: "/dashboard" },
  { key: "new-property", label: "New Estimate", href: "/" },
  { key: "project-data", label: "Project Data", href: "/attractors" },
  { key: "evaluations", label: "Calendar", href: "/evaluations" },
  { key: "tools", label: "Inventory", href: "/admin/tools" },
  { key: "materials", label: "Materials", href: "/admin/materials", parent: "tools" },
  { key: "services", label: "Services", href: "/admin/team", parent: "team" },
  { key: "team", label: "Team & Services", href: "/admin/team" },

  // Added after the matrix existed.
  { key: "proposals", label: "Proposals", href: "/proposals" },
  // Its own permission because it has its own page now. Invoices used to be a
  // tab on Money, which meant seeing a bill required seeing payroll.
  { key: "invoices", label: "Invoices", href: "/proposals", parent: "proposals" },
  { key: "contacts", label: "Contacts", href: "/contacts", parent: "project-data" },
  { key: "house-review", label: "Address Review", href: "/admin/houses", parent: "project-data" },
  { key: "gis-import", label: "County Import", href: "/admin/gis-import", parent: "project-data" },
  { key: "pipeline", label: "Pipeline", href: "/pipeline" },
  { key: "leads", label: "Lead Generation", href: "/leads" },
  { key: "conversations", label: "Conversations", href: "/conversations" },
  { key: "notifications", label: "Alerts", href: "/notifications" },
  { key: "weather", label: "Weather", href: "/weather", parent: "evaluations" },
  { key: "knowledge-graph", label: "Knowledge Graph", href: "/knowledge-graph" },

  // Money and admin tooling — closed until somebody says otherwise.
  { key: "payments", label: "Money", href: "/admin/payments" },
  { key: "journeys", label: "Journeys", href: "/admin/journeys", parent: "dashboard" },

  // Detail and sub-pages. Each still has its own guard; the checkbox layers
  // on top.
  { key: "job-detail", label: "Job Detail", href: "/jobs/[jobId]" },
  { key: "client-detail", label: "Contact Detail", href: "/clients/[customerId]" },
  { key: "conversation-thread", label: "Conversation Thread", href: "/conversations/[channelId]" },
  {
    key: "conversation-job",
    label: "Client Conversation",
    href: "/conversations/job/[jobId]",
    parent: "conversations",
  },
  { key: "conversation-call", label: "Video Call", href: "/conversations/[channelId]/call" },
  { key: "inventory-setup", label: "Inventory Setup", href: "/admin/inventory-setup", parent: "tools" },
  { key: "labels", label: "Labels & Codes", href: "/admin/labels", parent: "tools" },
  { key: "flyer", label: "Flyer Ad Spots", href: "/admin/flyer" },
  { key: "weeds", label: "Weed Guide", href: "/admin/weeds", parent: "tools" },
  {
    key: "expectations",
    label: "Setting Expectations",
    href: "/admin/expectations",
    parent: "evaluations",
  },
  { key: "kits", label: "Kit Checklists", href: "/admin/tools/kits", parent: "tools" },
  { key: "reminders", label: "Client Reminders", href: "/admin/reminders", parent: "tools" },
  { key: "social", label: "Before & After Posts", href: "/admin/social" },
  { key: "campaigns", label: "Email Campaigns", href: "/admin/campaigns" },
  { key: "recommendations", label: "Link Tracking", href: "/admin/outreach" },
  { key: "group-agent", label: "Where Posts Come From", href: "/admin/outreach/agent", parent: "recommendations" },
  { key: "posts-to-answer", label: "Posts to Answer", href: "/admin/outreach/posts", parent: "recommendations" },
  { key: "booking-page", label: "Booking Page", href: "/admin/booking-page", parent: "recommendations" },
  { key: "groups", label: "Local Groups", href: "/admin/groups" },
  // The business's own Meta app, the pages it connects, and their DMs in one inbox.
  { key: "meta", label: "Facebook & Instagram", href: "/admin/meta" },
  { key: "fleet", label: "Fleet", href: "/admin/fleet" },
  { key: "salt", label: "Salt Route", href: "/admin/salt" },
  { key: "subscriptions", label: "Subscriptions", href: "/admin/subscriptions", parent: "payments" },
  { key: "transactions", label: "Transactions", href: "/admin/transactions", parent: "payments" },
  { key: "door-hangers", label: "Door Hangers", href: "/admin/door-hangers" },
  { key: "signs", label: "Neighborhood Sign", href: "/admin/marketing/poster" },
  { key: "organizations", label: "Organizations", href: "/admin/organizations" },
  // Requests from the quick mow page, from a price seen to a lawn mowed: its own pipeline.
  { key: "mow-orders", label: "Quick Mow Pipeline", href: "/mow-orders" },
  // Applicants from the job ads: their answers, their videos, and who gets an interview.
  { key: "hiring", label: "Hiring", href: "/admin/hiring" },
  // The crew's pay and each service's production rate: what every forward price is worked out from.
  { key: "production-rates", label: "Production Rates", href: "/admin/production-rates" },
  // Every internal number on one page: crew pay, commissions, capacity multipliers, the indirect pool, rates.
  { key: "variables", label: "Variables", href: "/admin/variables" },
  // Bulk mulch, topsoil and stone suppliers near the work: prices, delivery fees and minimums.
  { key: "suppliers", label: "Bulk Suppliers", href: "/admin/suppliers" },
  // The company shirts: the designs, and ordering them by design, colour and size.
  { key: "shirts", label: "Company Shirts", href: "/admin/shirts" },
];

export type TabKey = string;

/**
 * Routes that exist but aren't governed tabs, with the reason. The test reads
 * this, so anything added here is a decision on the record rather than a gap.
 */
export const UNGOVERNED_ROUTES: Record<string, string> = {
  "/admin/hiring/[id]":
    "One applicant, opened from the Hiring list. Checks the hiring tab itself, and its actions check it again " +
    "before rating, moving or emailing anyone.",
  "/login": "Sign-in page, nobody is signed in yet, so there are no roles to check.",
  "/admin/view-as":
    "See the app as another team member. Gated on the account actually signed in being an admin, " +
    "not on a tab, so an admin already viewing as somebody can switch to the next person.",
  "/p/[slug]":
    "A person's own link. Signed out it shows the sign-in form with their email filled in; signed in as them it sends them " +
    "to their home; signed in as anyone else it only offers to sign out. It shows a first name and nothing else.",
  "/me":
    "Everyone's own home in the phone layout. Each person sees only their own day, link, wallet and stage; the account manager's " +
    "and owner's cards read through the same loaders their v2 home screens use, and only the owner can open another role's layout.",
  "/schedule":
    "The one Schedule app from the home screen (today, next month, history). Signed-in team only; reads go through row-level " +
    "security, and site visits are the owner's all or the account manager's own clients.",
};

/**
 * Which tabs a person can see.
 *
 * Nothing is open to the team until an admin ticks it. A page with no grants
 * at all is visible to admins only — that keeps a page reachable by whoever
 * has to make the call about it, without ever handing it to the whole team on
 * its own.
 */
export function tabsAllowedForRoles(
  roles: string[],
  permissions: { role_name: string; tab_key: string; granted?: boolean | null }[]
): Set<string> {
  const allowed = new Set<string>();
  const deniedToAdmin = new Set<string>();

  for (const permission of permissions) {
    const granted = permission.granted ?? true;
    if (permission.role_name === "admin" && !granted) deniedToAdmin.add(permission.tab_key);
    if (!granted) continue;
    if (roles.includes(permission.role_name)) allowed.add(permission.tab_key);
  }

  // An admin sees everything they have not explicitly turned off for
  // themselves. It used to be everything nobody had ticked for anybody, which
  // meant granting a page to the crew silently took it off the admin's own
  // menu -- the trap that made "I enabled permissions and lost my tabs" the
  // expected outcome rather than a surprise. Unticking your own box still
  // works, because a deny is now a row rather than an absence.
  if (roles.includes("admin")) {
    for (const tab of TABS) {
      if (!deniedToAdmin.has(tab.key)) allowed.add(tab.key);
    }
  }

  return allowed;
}

/** Tabs nobody has been granted or denied yet — the matrix flags these. */
export function unconfiguredTabKeys(permissions: { tab_key: string }[]): Set<string> {
  const configured = new Set(permissions.map((p) => p.tab_key));
  return new Set(TABS.filter((t) => !configured.has(t.key)).map((t) => t.key));
}

const BY_KEY = new Map(TABS.map((t) => [t.key, t]));

/** What a page is called. One answer, used by the matrix, the nav and the page. */
export function tabLabel(key: string): string {
  return BY_KEY.get(key)?.label ?? key;
}

export function tabFor(key: string): TabDefinition | undefined {
  return BY_KEY.get(key);
}
