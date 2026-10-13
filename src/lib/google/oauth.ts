/**
 * Signing in to Google on the business's behalf, once.
 *
 * The owner makes a Google Cloud OAuth client (a client ID and a secret),
 * pastes the two into Settings › Integrations, and presses Connect. Google
 * sends back a code; the code becomes a refresh token, which is kept in
 * integration_credentials and turned into a short-lived access token each
 * time the app needs to talk to Google. Nobody signs in again unless they
 * revoke it.
 *
 * Server only. Tokens never reach a browser or the log.
 */

export const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";

export const GOOGLE_SCOPES = {
  google_business: ["https://www.googleapis.com/auth/business.manage"],
  google_ads: ["https://www.googleapis.com/auth/adwords"],
  google_lsa: ["https://www.googleapis.com/auth/adwords"],
} as const;

export type GoogleProviderId = keyof typeof GOOGLE_SCOPES;

export function isGoogleProvider(id: string): id is GoogleProviderId {
  return id in GOOGLE_SCOPES;
}

/** Where Connect sends the owner. `prompt=consent` so Google always hands back a refresh token. */
export function googleAuthUrl(input: { clientId: string; redirectUri: string; scopes: readonly string[]; state: string }): string {
  const url = new URL(GOOGLE_AUTH_URL);
  url.searchParams.set("client_id", input.clientId);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", input.scopes.join(" "));
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("include_granted_scopes", "true");
  url.searchParams.set("state", input.state);
  return url.toString();
}

export interface GoogleTokens {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: number;
}

async function tokenRequest(body: Record<string, string>): Promise<GoogleTokens> {
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body),
  });
  const json = (await response.json().catch(() => ({}))) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    error?: string;
    error_description?: string;
  };
  if (!response.ok || !json.access_token) {
    throw new Error(json.error_description || json.error || `Google answered ${response.status}.`);
  }
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token ?? null,
    expiresAt: Date.now() + Math.max(60, (json.expires_in ?? 3600) - 60) * 1000,
  };
}

/** The code from the callback, swapped for tokens. */
export function exchangeGoogleCode(input: { clientId: string; clientSecret: string; code: string; redirectUri: string }): Promise<GoogleTokens> {
  return tokenRequest({
    code: input.code,
    client_id: input.clientId,
    client_secret: input.clientSecret,
    redirect_uri: input.redirectUri,
    grant_type: "authorization_code",
  });
}

// Access tokens last an hour; one run asks many times. Kept per refresh token
// for the life of this server instance only.
const cache = new Map<string, GoogleTokens>();

/** A working access token from saved secrets, or an error saying what is missing. */
export async function googleAccessToken(secrets: Record<string, string> | null): Promise<{ ok: true; token: string } | { ok: false; error: string }> {
  if (!secrets?.client_id || !secrets?.client_secret) return { ok: false, error: "Not connected — add it in Settings › Integrations." };
  if (!secrets.refresh_token) return { ok: false, error: "Saved, but not signed in yet — press Connect in Settings › Integrations." };
  const held = cache.get(secrets.refresh_token);
  if (held && held.expiresAt > Date.now()) return { ok: true, token: held.accessToken };
  try {
    const tokens = await tokenRequest({
      client_id: secrets.client_id,
      client_secret: secrets.client_secret,
      refresh_token: secrets.refresh_token,
      grant_type: "refresh_token",
    });
    cache.set(secrets.refresh_token, tokens);
    return { ok: true, token: tokens.accessToken };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Google refused the saved sign-in." };
  }
}
