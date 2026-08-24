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
  label: string;
  href: string;
}

export const TABS: readonly TabDefinition[] = [
  { key: "dashboard", label: "Dashboard", href: "/dashboard" },
  { key: "new-property", label: "New Property (Home)", href: "/" },
  { key: "project-data", label: "Project Data", href: "/attractors" },
  { key: "evaluations", label: "Calendar", href: "/evaluations" },
  { key: "tools", label: "Tool Database", href: "/admin/tools" },
  { key: "materials", label: "Material Database", href: "/admin/materials" },
  { key: "services", label: "Services Database", href: "/admin/team" },
  { key: "team", label: "Team Database", href: "/admin/team" },

  // Added after the matrix existed.
  { key: "proposals", label: "Proposals", href: "/proposals" },
  { key: "contacts", label: "Contacts", href: "/contacts" },
  { key: "pipeline", label: "Pipeline", href: "/pipeline" },
  { key: "leads", label: "Lead Generation", href: "/leads" },
  { key: "conversations", label: "Conversations", href: "/conversations" },
  { key: "notifications", label: "Notifications", href: "/notifications" },
  { key: "weather", label: "Weather", href: "/weather" },

  // Money and admin tooling — closed until somebody says otherwise.
  { key: "payments", label: "Money", href: "/admin/payments" },
  { key: "journeys", label: "Journey Dashboard", href: "/admin/journeys" },
  { key: "gambling", label: "Gambling (test)", href: "/gambling" },

  // Detail and sub-pages. Each still has its own guard; the checkbox layers
  // on top.
  { key: "job-detail", label: "Job Detail", href: "/jobs/[jobId]" },
  { key: "client-detail", label: "Contact Detail", href: "/clients/[customerId]" },
  { key: "conversation-thread", label: "Conversation Thread", href: "/conversations/[channelId]" },
  { key: "conversation-call", label: "Video Call", href: "/conversations/[channelId]/call" },
  { key: "inventory-setup", label: "Inventory Setup", href: "/admin/inventory-setup" },
  { key: "organizations", label: "Organizations", href: "/admin/organizations" },
];

export type TabKey = string;

/**
 * Routes that exist but aren't governed tabs, with the reason. The test reads
 * this, so anything added here is a decision on the record rather than a gap.
 */
export const UNGOVERNED_ROUTES: Record<string, string> = {
  "/login": "Sign-in page — nobody is signed in yet, so there are no roles to check.",
  "/proposal/[token]": "Opened by a client from an emailed link. They have no account at all.",
  "/admin/permissions": "This screen. Gated on the admin role directly so it can't be locked away.",
  "/admin/database":
    "Shows which migrations still need running. Gated on the admin role directly, not on a tab — " +
    "the tab list lives in the database this page exists to repair.",
  "/today":
    "The crew's own day. Shows only the signed-in person's stops, so there is nothing to withhold — " +
    "and gating it behind a tick is how somebody ends up in a yard with nothing to press.",
  "/my-day":
    "The account manager's own day. Same argument as Today: it shows the signed-in person their own " +
    "clients and jobs and nobody else's, so there is nothing to withhold, and a tick could leave " +
    "somebody with no screen to open.",
  "/jobs/[jobId]/work-order":
    "The crew's sheet for one job, at its own URL so anybody can check what the crew will be " +
    "looking at. Guarded by requireJobAccess like the job page itself — it shows the work in a job, " +
    "and whoever can open the job can see that.",
  "/admin/service-pricing": "Not a page — it redirects straight to Team & Services.",
  "/admin/overhead": "Not a page — Overhead is a tab on Money now, and this redirects there.",
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
