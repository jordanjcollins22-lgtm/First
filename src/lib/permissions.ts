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
  { key: "social", label: "Before & After Posts", href: "/admin/social" },
  { key: "door-hangers", label: "Door Hangers", href: "/admin/door-hangers" },
  { key: "organizations", label: "Organizations", href: "/admin/organizations" },
];

export type TabKey = string;

/**
 * Routes that exist but aren't governed tabs, with the reason. The test reads
 * this, so anything added here is a decision on the record rather than a gap.
 */
export const UNGOVERNED_ROUTES: Record<string, string> = {
  "/login": "Sign-in page — nobody is signed in yet, so there are no roles to check.",
  "/progress/[token]":
    "Opened by a property manager, management company or family member from a link. No account, and " +
    "no pricing on the page — the token is the whole of their access.",
  "/admin/permissions": "Redirects to Settings, where it is a tab.",
  "/admin/settings":
    "Permissions, database setup and organizations in one place. Gated on the admin role directly " +
    "rather than on a tab — the tab list lives in the database these tabs exist to repair, and a " +
    "page that could be locked away by the thing it fixes is a trap.",
  "/admin/database": "Redirects to Settings, where it is a tab.",
  "/today": "Redirects to My Day, which shows a crew member their own stops.",
  "/my-day":
    "Whoever is signed in, looking at their own work — stops for a crew member, clients and jobs " +
    "for anybody else. It shows one person their own day and nobody else's, so there is nothing to " +
    "withhold, and a tick could leave somebody with no screen to open.",
  "/jobs/[jobId]/directions":
    "The way to one job's address, drawn in the app. Guarded by requireJobAccess like the job page — " +
    "it shows a property address, which anybody who can open the job can already see.",
  "/jobs/[jobId]/work-order":
    "The crew's sheet for one job, at its own URL so anybody can check what the crew will be " +
    "looking at. Guarded by requireJobAccess like the job page itself — it shows the work in a job, " +
    "and whoever can open the job can see that.",
  "/i/[code]":
    "What a sticker opens. Whoever is holding the thing is standing in front of it, so gating the " +
    "scan behind a tick is how somebody ends up unable to sign a saw back in. It still needs a " +
    "signed-in person to record a movement, and it shows one item and nothing else.",
  "/admin/service-pricing": "Not a page — it redirects straight to Team & Services.",
  "/admin/overhead": "Not a page — Overhead is a tab on Money now, and this redirects there.",
  "/more":
    "The drawer holding every tool that is not one of the eight. It lists only pages the viewer " +
    "already has permission for and links to nothing else, so a tick of its own would withhold " +
    "nothing and could leave somebody with no way to reach a page they were granted.",
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
  permissions: { role_name: string; tab_key: string }[]
): Set<string> {
  const allowed = new Set<string>();
  const configured = new Set(permissions.map((p) => p.tab_key));

  for (const p of permissions) {
    if (roles.includes(p.role_name)) allowed.add(p.tab_key);
  }

  if (roles.includes("admin")) {
    for (const tab of TABS) {
      if (!configured.has(tab.key)) allowed.add(tab.key);
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
