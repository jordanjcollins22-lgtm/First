import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Minimal shared-password gate for the /govcon dashboard (bids and prices
 * are sensitive, and the app has no sign-in UI yet). The cookie holds an
 * HMAC of the password, never the password itself.
 */
export const GOVCON_AUTH_COOKIE = "govcon_auth";

export function dashboardToken(password: string): string {
  return createHmac("sha256", password).update("govcon-dashboard-v1").digest("hex");
}

/** null = no password configured (allowed in development only). */
export function isGovconAuthorized(cookieValue: string | undefined): boolean {
  const password = process.env.GOVCON_DASHBOARD_PASSWORD;
  if (!password) return process.env.NODE_ENV !== "production";
  if (!cookieValue) return false;
  const expected = Buffer.from(dashboardToken(password));
  const actual = Buffer.from(cookieValue);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
