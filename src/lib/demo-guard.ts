/**
 * The demo: the app as somebody on the team sees it, with live data, and
 * nothing saved.
 *
 * Opened from Admin > Demo, it is a cookie. While it is set, every request
 * the app makes to the database is looked at before it goes: reading goes
 * through, anything that would change something is refused with DEMO_BLOCKED.
 * The emails, texts, calls, payments and posts the app sends are refused the
 * same way (see demo-mode.ts). So the whole app can be walked round as a
 * person with a role, and nothing live changes.
 *
 * Pure, so what is let through is tested without a network.
 */

export const DEMO_COOKIE = "js_demo";

export const DEMO_BLOCKED = "This is the demo: nothing you do here is saved or sent.";

/**
 * Database functions the app calls that only read, so a demo can run them.
 * Every other function is refused: a function not on this list may change
 * something, and a new one is refused until somebody adds it here.
 */
export const READ_ONLY_RPCS: ReadonlySet<string> = new Set([
  "bank_status",
  "evaluation_sequence_due",
  "evaluation_sequence_effective",
  "gis_integrity_report",
  "house_facts",
  "house_nearest",
  "houses_coverage",
  "houses_door_list",
  "houses_in_bbox",
  "houses_in_ring_count",
  "houses_zip_counts",
  "jobs_with_open_exceptions",
  "marketing_approval_state",
  "marketing_hanger_targets",
  "marketing_play_doors",
  "marketing_play_route",
  "marketing_plays_list",
  "ops_actions_list",
  "owner_intervention_load",
  "summary_get",
  "weed_by_code",
  "zone_approvals",
  "zones_rewalk_pending",
]);

/** Auth calls that keep somebody signed in, or ask who they are. */
const AUTH_ALLOWED = [/^\/auth\/v1\/token$/, /^\/auth\/v1\/user$/, /^\/auth\/v1\/logout$/, /^\/auth\/v1\/settings$/];

/**
 * Whether a request to the database is refused in the demo. Only requests to
 * the Supabase project are judged; anything else is left to the send guards.
 */
export function demoBlocks(url: string, method = "GET"): boolean {
  let path: string;
  try {
    path = new URL(url).pathname;
  } catch {
    return false;
  }
  const m = method.toUpperCase();
  const reading = m === "GET" || m === "HEAD" || m === "OPTIONS";

  if (path.startsWith("/rest/v1/rpc/")) {
    const fn = decodeURIComponent(path.slice("/rest/v1/rpc/".length)).split("?")[0];
    return !(reading || READ_ONLY_RPCS.has(fn));
  }
  if (path.startsWith("/rest/v1/")) return !reading;
  if (path.startsWith("/storage/v1/")) {
    if (reading) return false;
    // Listing a folder and signing a link to look at a file are POSTs that change nothing.
    return !(/^\/storage\/v1\/object\/(list|sign)\//.test(path) || /^\/storage\/v1\/object\/sign\//.test(path));
  }
  if (path.startsWith("/auth/v1/")) {
    if (AUTH_ALLOWED.some((re) => re.test(path))) return m === "PUT";
    return !reading;
  }
  if (path.startsWith("/functions/v1/")) return true;
  return false;
}

/** A refusal shaped like the database's own errors, so every screen shows it the way it shows any other. */
export function demoRefusal(): Response {
  return new Response(JSON.stringify({ message: DEMO_BLOCKED, code: "DEMO", details: null, hint: null }), {
    status: 403,
    headers: { "content-type": "application/json" },
  });
}

/** Whether a cookie header, or document.cookie, says a demo is open. */
export function cookieSaysDemo(cookieHeader: string | null | undefined): boolean {
  if (!cookieHeader) return false;
  return cookieHeader.split(/;\s*/).some((part) => part === `${DEMO_COOKIE}=1`);
}
