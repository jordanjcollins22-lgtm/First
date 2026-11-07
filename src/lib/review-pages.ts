/**
 * Review pages are public so a reviewer is never asked to sign in, so they
 * must never exist on the live site: only on a Vercel preview, or locally.
 */
export function reviewPagesEnabled(env: Record<string, string | undefined> = process.env): boolean {
  if (env.VERCEL_ENV) return env.VERCEL_ENV === "preview";
  return env.NODE_ENV !== "production";
}
