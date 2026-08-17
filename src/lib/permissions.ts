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

export type DefaultAccess = "everyone" | "admin";

export interface TabDefinition {
  key: string;
  label: string;
  href: string;
  /**
   * Who sees the page before an admin has ticked anything for it.
   *
   * A brand-new page has no rows in role_permissions, and the honest reading
   * of that is "nobody has decided yet" rather than "denied to all" — which
   * would hide it from the admin who needs to make the call. "admin" is the
   * default for anything new; "everyone" is only for pages that were already
   * open to the whole team before they were governed here, so turning this on
   * took nothing away from anyone.
   */
  defaultAccess: DefaultAccess;
}

export const TABS: readonly TabDefinition[] = [
  { key: "new-property", label: "New Property (Home)", href: "/", defaultAccess: "admin" },
  { key: "project-data", label: "Project Data", href: "/attractors", defaultAccess: "admin" },
  { key: "evaluations", label: "Calendar", href: "/evaluations", defaultAccess: "admin" },
  { key: "tools", label: "Tool Database", href: "/admin/tools", defaultAccess: "admin" },
  { key: "materials", label: "Material Database", href: "/admin/materials", defaultAccess: "admin" },
  { key: "services", label: "Services Database", href: "/admin/team", defaultAccess: "admin" },
  { key: "team", label: "Team Database", href: "/admin/team", defaultAccess: "admin" },

  // Added after the matrix existed. These were open to everyone signed in, so
  // they default that way — governing them changed nobody's access on day one.
  { key: "proposals", label: "Proposals", href: "/proposals", defaultAccess: "everyone" },
  { key: "contacts", label: "Contacts", href: "/contacts", defaultAccess: "everyone" },
  { key: "pipeline", label: "Pipeline", href: "/pipeline", defaultAccess: "everyone" },
  { key: "conversations", label: "Conversations", href: "/conversations", defaultAccess: "everyone" },
  { key: "notifications", label: "Notifications", href: "/notifications", defaultAccess: "everyone" },
  { key: "weather", label: "Weather", href: "/weather", defaultAccess: "everyone" },

  // Money and admin tooling — closed until somebody says otherwise.
  { key: "payments", label: "Payments", href: "/admin/payments", defaultAccess: "admin" },
  { key: "overhead", label: "Overhead", href: "/admin/overhead", defaultAccess: "admin" },
  { key: "journeys", label: "Journey Dashboard", href: "/admin/journeys", defaultAccess: "admin" },
  { key: "gambling", label: "Gambling (test)", href: "/gambling", defaultAccess: "admin" },

  // Detail and sub-pages. They already had their own guards, so these default
  // to "everyone" — the checkbox layers on top and only starts biting once
  // somebody actually ticks or unticks it.
  { key: "job-detail", label: "Job Detail", href: "/jobs/[jobId]", defaultAccess: "everyone" },
  { key: "client-detail", label: "Contact Detail", href: "/clients/[customerId]", defaultAccess: "everyone" },
  {
    key: "conversation-thread",
    label: "Conversation Thread",
    href: "/conversations/[channelId]",
    defaultAccess: "everyone",
  },
  {
    key: "conversation-call",
    label: "Video Call",
    href: "/conversations/[channelId]/call",
    defaultAccess: "everyone",
  },
  {
    key: "inventory-setup",
    label: "Inventory Setup",
    href: "/admin/inventory-setup",
    defaultAccess: "everyone",
  },
  {
    key: "organizations",
    label: "Organizations",
    href: "/admin/organizations",
    defaultAccess: "admin",
  },
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
  "/admin/service-pricing": "Not a page — it redirects straight to Team & Services.",
};

/**
 * Which tabs a person can see.
 *
 * A tab with no grants at all hasn't been configured yet — it falls back to
 * its declared default instead of vanishing, so a page added today is visible
 * to whoever should see it and shows up on the matrix waiting for a decision.
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

  for (const tab of TABS) {
    if (configured.has(tab.key)) continue;
    if (tab.defaultAccess === "everyone" || roles.includes("admin")) allowed.add(tab.key);
  }

  return allowed;
}

/** Tabs nobody has been granted or denied yet — the matrix flags these. */
export function unconfiguredTabKeys(permissions: { tab_key: string }[]): Set<string> {
  const configured = new Set(permissions.map((p) => p.tab_key));
  return new Set(TABS.filter((t) => !configured.has(t.key)).map((t) => t.key));
}
