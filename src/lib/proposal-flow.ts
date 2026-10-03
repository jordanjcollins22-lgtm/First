/**
 * The road a client walks after they open their proposal link.
 *
 * Three screens, one decision each: read it and accept, say how you are
 * paying, and a confirmation that a team member is picking it up. They were
 * one long scrolling page, which meant a
 * client who had already decided could scroll back up, re-read the price and
 * talk themselves out of it. Each step is its own URL now, and none of them
 * offers a way back to the one before.
 *
 * Pure module so the routes are written once and the same strings can be
 * asserted in a test rather than typed out again at every call site.
 */

export function proposalPath(token: string): string {
  return `/proposal/${token}`;
}

/** How they are paying, on its own, with nothing else on the screen. */
export function payPath(token: string): string {
  return `/proposal/${token}/pay`;
}

/**
 * What happens next, once the money is sorted.
 *
 * Still called the schedule path because it is the same URL clients and
 * Stripe already have. It no longer lets anybody choose a day: the office
 * books the crew, once the proposal is accepted and paid.
 */
export function schedulePath(token: string): string {
  return `/proposal/${token}/schedule`;
}

/**
 * Where Stripe sends them back to.
 *
 * Absolute, because Stripe redirects a browser rather than following a
 * relative path. Falls back to a relative path when nothing has told us our
 * own address, which at least lands somewhere sensible in development.
 */
export function absolute(baseUrl: string, path: string): string {
  const trimmed = baseUrl.replace(/\/+$/, "");
  return trimmed ? `${trimmed}${path}` : path;
}

// ---------------------------------------------------------------------------
// Preview
// ---------------------------------------------------------------------------

/**
 * Preview opens the client's real proposal, on the real token, because that
 * is the only honest way to see what they will see. It used to open it live
 * as well, so a staff member who tapped Accept to see what happened accepted
 * on the client's behalf and the client's next visit found the proposal
 * already answered.
 *
 * So preview is read-only, and says so on every control rather than hiding
 * them, since a preview with the buttons missing is not a preview.
 */
export const PREVIEW_BLOCKED = "Preview only. Nothing here touches the client's proposal.";

export function isPreview(param: string | string[] | undefined): boolean {
  return (Array.isArray(param) ? param[0] : param) === "1";
}

/** The result a public action would have returned, without doing anything. */
export function previewResult(): { ok: false; message: string } {
  return { ok: false, message: PREVIEW_BLOCKED };
}
