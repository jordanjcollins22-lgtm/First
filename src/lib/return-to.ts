/**
 * Where to send somebody after they sign in.
 *
 * A link in an email says "approve them here" and points at My Day. On a
 * phone that has been signed out, that link went to the sign-in page, and
 * the sign-in page went to the front door, and the person stood at the
 * front door wondering where the thing they were sent to had gone. So the
 * page they wanted rides along on the sign-in URL and is where they land.
 *
 * Only a path on this site is honoured. Anything with a scheme or a
 * protocol-relative start would turn the sign-in page into a door out.
 */

const HOME = "/";

/** The path to go to after signing in, or the front door when it is not safe. */
export function safeReturnTo(raw: string | null | undefined): string {
  const value = (raw ?? "").trim();
  if (!value.startsWith("/")) return HOME;
  if (value.startsWith("//") || value.startsWith("/\\")) return HOME;
  if (/[\r\n]/.test(value)) return HOME;
  if (/^\/login(\/|\?|#|$)/.test(value)) return HOME;
  return value;
}

/** The sign-in URL that remembers where somebody was going. */
export function loginUrlFor(pathname: string, search: string): string {
  const wanted = `${pathname}${search}`;
  if (!wanted || wanted === "/" || safeReturnTo(wanted) === HOME) return "/login";
  return `/login?next=${encodeURIComponent(wanted)}`;
}
