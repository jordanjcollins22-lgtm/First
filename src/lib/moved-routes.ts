/**
 * Old addresses, in a file with no imports.
 *
 * next.config.ts reads these to build the redirects, and the config loader
 * does not resolve the "@/" alias -- so this file deliberately imports
 * nothing. modules.ts re-exports it, and everything else goes on importing
 * from there.
 */

/**
 * Where an old address goes now.
 *
 * These pages were absorbed into a module: their screen is a subtab, so the
 * address is a redirect. next.config.ts reads this table and Next checks those
 * redirects before the filesystem, which is what lets the module pages go on
 * importing the page components while nobody can reach them by URL any more.
 *
 * A link somebody bookmarked, texted or wrote into a document keeps working,
 * and the query string is carried across, so /attractors?zone=abc still lands
 * on that zone.
 */
export const MOVED: Record<string, string> = {
  "/dashboard": "/my-day?tab=business",
  "/notifications": "/my-day?tab=alerts",
  "/pipeline": "/sales?tab=pipeline",
  "/contacts": "/sales?tab=clients",
  "/proposals": "/sales?tab=proposals",
  "/evaluations": "/operations?tab=calendar",
  "/weather": "/operations?tab=weather",
  // The six modules became four departments. Schedule and Jobs are both
  // Operations now, and More is Admin.
  "/schedule": "/operations?tab=calendar",
  "/jobs": "/operations?tab=jobs",
  "/more": "/admin",
  "/admin/salt": "/operations?tab=salt",
  "/attractors": "/marketing?tab=map",
  "/leads": "/marketing?tab=leads",
  "/admin/door-hangers": "/marketing?tab=print",
  "/admin/flyer": "/marketing?tab=print",
  "/admin/social": "/marketing?tab=content",
  "/admin/organizations": "/admin/settings",
};

/**
 * Pages that are still their own page, reached through Admin.
 *
 * These were never absorbed into a module: Admin lists them and links to
 * them, so redirecting them into Admin would be a door that opens onto
 * itself. They keep their addresses, their permissions and their screens,
 * and the grouping on the Admin page is the only thing that changed about
 * them.
 */
export const REACHED_VIA_ADMIN: Record<string, string> = {
  "/admin/tools": "inventory",
  "/admin/materials": "inventory",
  "/admin/labels": "inventory",
  "/admin/inventory-setup": "inventory",
  "/admin/team": "team",
  "/admin/payments": "finance",
  "/admin/weeds": "field-guide",
  "/admin/houses": "data",
  "/admin/gis-import": "data",
  "/knowledge-graph": "knowledge",
};
