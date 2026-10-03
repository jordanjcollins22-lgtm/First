/**
 * Telling "signed out" apart from "couldn't check".
 *
 * The middleware asks Supabase's auth server who the user is on every request.
 * That is a network call, and on a phone it sometimes fails — a cold start, a
 * dead spot, a blip at the other end. Treating that failure as "not signed in"
 * bounces somebody with a perfectly good session to the login screen, which is
 * why the app occasionally had to be loaded twice.
 *
 * Pure helpers so the decision can be tested without a network or a database.
 */

/** Supabase stores its session in sb-<project-ref>-auth-token, split across
 * numbered chunks when it is too big for one cookie. */
const AUTH_COOKIE = /^sb-.+-auth-token(\.\d+)?$/;

export function hasAuthCookie(cookieNames: string[]): boolean {
  return cookieNames.some((name) => AUTH_COOKIE.test(name));
}

export interface AuthCheckError {
  status?: number;
  name?: string;
  message?: string;
}

/**
 * Whether an error means the session is genuinely invalid, as opposed to the
 * check not having completed.
 *
 * 401 and 403 are the auth server saying no. Everything else — a timeout, a
 * DNS failure, a 500, a fetch that never resolved — is us failing to ask, and
 * must not be read as an answer.
 */
export function isDefinitiveAuthFailure(error: AuthCheckError | null | undefined): boolean {
  if (!error) return false;
  if (error.status === 401 || error.status === 403) return true;
  // supabase-js flags transport problems it would retry; those are never a
  // verdict on the session.
  if (error.name === "AuthRetryableFetchError") return false;
  return false;
}

export type Decision = "allow" | "redirect_to_login";

/**
 * What the middleware should do.
 *
 * A request with no auth cookie at all is signed out, decided without asking
 * anybody. Beyond that, somebody is only sent to the login screen when the
 * auth server actually said no — if the check merely failed, the request goes
 * through and the page does its own gating. The worst case is a page that
 * renders signed-out, which the person can act on; the alternative is being
 * thrown out of an app they are legitimately logged into.
 */
export function decideAccess(input: {
  isPublicPath: boolean;
  cookieNames: string[];
  user: unknown | null;
  error: AuthCheckError | null | undefined;
}): Decision {
  if (input.isPublicPath) return "allow";
  if (input.user) return "allow";
  if (!hasAuthCookie(input.cookieNames)) return "redirect_to_login";
  if (isDefinitiveAuthFailure(input.error)) return "redirect_to_login";

  // Cookie present, no user, and no definitive answer: the check did not
  // complete. Let it through rather than throwing somebody out on a blip.
  return input.error ? "allow" : "redirect_to_login";
}

export interface UserLookup {
  data: { user: unknown | null };
  error?: AuthCheckError | null;
}

/**
 * Asks who the user is, once more if the first attempt failed for a reason
 * that was not an answer.
 *
 * A page cannot do what the middleware does and carry on regardless — it has
 * to know whose data to load, and inventing an identity would be a security
 * hole rather than a kindness. But it also should not send somebody to the
 * login screen because a single request lost the network. One retry costs
 * milliseconds and resolves nearly all of it; a session that is genuinely
 * expired still fails twice and still redirects.
 */
export async function getUserWithRetry(
  lookup: () => Promise<UserLookup>,
  attempts = 2
): Promise<UserLookup> {
  let last: UserLookup = { data: { user: null }, error: null };

  for (let i = 0; i < attempts; i++) {
    try {
      last = await lookup();
    } catch (thrown) {
      last = {
        data: { user: null },
        error: {
          name: thrown instanceof Error ? thrown.name : "Error",
          message: thrown instanceof Error ? thrown.message : String(thrown),
        },
      };
    }

    if (last.data.user) return last;
    // A clean "nobody" and a rejected token are both answers — retrying them
    // would only slow down every signed-out page load.
    if (!last.error || isDefinitiveAuthFailure(last.error)) return last;
  }

  return last;
}
