/**
 * Affiliate links. The QR code on a magnet never points straight at the
 * landing page: it points at /r/<code> on this app, which logs the scan and
 * redirects. So the landing page can change without reprinting anything.
 */

/** Shown in previews before a team member is picked. */
export const SAMPLE_AFFILIATE_CODE = "ABC123";

export function normalizeAffiliateCode(code: string) {
  return code.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function affiliateLink(origin: string, code: string) {
  return `${origin.replace(/\/+$/, "")}/r/${normalizeAffiliateCode(code)}`;
}

/** Landing page with ?ref=<code> added, keeping any query it already has. */
export function landingUrlFor(landingUrl: string, code: string | null) {
  const url = new URL(landingUrl);
  if (code) url.searchParams.set("ref", code);
  return url.toString();
}
