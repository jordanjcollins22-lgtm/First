import { createHash, randomBytes } from "node:crypto";

/**
 * The parts of OAuth 2.0 that are pure: building the sign-in address, the
 * PKCE pair, reading a token response, and deciding when a token needs
 * refreshing. No network and no cookies here, so it can be tested. The
 * server-side flow that uses these is in ./oauth.ts.
 */

export interface OAuthClientConfig {
  /** The integration id; tokens are saved under it in integration_credentials. */
  provider: string;
  authorizeUrl: string;
  tokenUrl: string;
  clientId: string;
  /** Absent for public clients that rely on PKCE alone. */
  clientSecret?: string;
  scopes: string[];
  /** Exactly the address registered with the provider. */
  redirectUri: string;
  /** Send a PKCE challenge. Google recommends it; some providers require it. */
  pkce?: boolean;
  /**
   * How the client id and secret travel to the token endpoint. Intuit and
   * most others take HTTP Basic; Google takes either. Default "basic".
   */
  clientAuth?: "basic" | "body";
  /** Separator between scopes. Space unless the provider says otherwise. */
  scopeSeparator?: string;
  /** Extra sign-in parameters, e.g. Google's access_type=offline and prompt=consent. */
  extraAuthorizeParams?: Record<string, string>;
}

export interface TokenSet {
  accessToken: string;
  /** Some providers only send it the first time; keep the old one when absent. */
  refreshToken: string | null;
  /** ISO time the access token stops working, or null when it was not said. */
  expiresAt: string | null;
  /** ISO time the refresh token stops working (Intuit sends this). */
  refreshExpiresAt: string | null;
  scope: string | null;
  tokenType: string | null;
  /** Whatever else came back (Intuit's realmId is on the redirect, not here). */
  raw: Record<string, unknown>;
}

const b64url = (buf: Buffer) => buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

export function randomState(): string {
  return b64url(randomBytes(24));
}

/** A PKCE verifier (43–128 chars) and its S256 challenge. */
export function pkcePair(): { verifier: string; challenge: string } {
  const verifier = b64url(randomBytes(48));
  return { verifier, challenge: pkceChallenge(verifier) };
}

export function pkceChallenge(verifier: string): string {
  return b64url(createHash("sha256").update(verifier).digest());
}

export function buildAuthorizeUrl(config: OAuthClientConfig, state: string, challenge?: string | null): string {
  const url = new URL(config.authorizeUrl);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("scope", config.scopes.join(config.scopeSeparator ?? " "));
  url.searchParams.set("state", state);
  if (challenge) {
    url.searchParams.set("code_challenge", challenge);
    url.searchParams.set("code_challenge_method", "S256");
  }
  for (const [k, v] of Object.entries(config.extraAuthorizeParams ?? {})) url.searchParams.set(k, v);
  return url.toString();
}

/** The headers and form body for a token request, with the client authenticated the way the provider wants. */
export function tokenRequest(
  config: OAuthClientConfig,
  params: Record<string, string>
): { headers: Record<string, string>; body: URLSearchParams } {
  const body = new URLSearchParams(params);
  const headers: Record<string, string> = {
    "Content-Type": "application/x-www-form-urlencoded",
    Accept: "application/json",
  };
  if ((config.clientAuth ?? "basic") === "basic" && config.clientSecret) {
    headers.Authorization = `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64")}`;
  } else {
    body.set("client_id", config.clientId);
    if (config.clientSecret) body.set("client_secret", config.clientSecret);
  }
  return { headers, body };
}

/** Turns a token endpoint's JSON into a TokenSet. Throws when there is no access token. */
export function parseTokenResponse(json: Record<string, unknown>, now: Date = new Date()): TokenSet {
  const accessToken = typeof json.access_token === "string" ? json.access_token : "";
  if (!accessToken) {
    const why = (json.error_description ?? json.error ?? "no access token in the reply") as string;
    throw new Error(String(why));
  }
  const seconds = (v: unknown) => (typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN);
  const at = (s: number) => (Number.isFinite(s) && s > 0 ? new Date(now.getTime() + s * 1000).toISOString() : null);
  return {
    accessToken,
    refreshToken: typeof json.refresh_token === "string" && json.refresh_token ? json.refresh_token : null,
    expiresAt: at(seconds(json.expires_in)),
    refreshExpiresAt: at(seconds(json.x_refresh_token_expires_in ?? json.refresh_token_expires_in)),
    scope: typeof json.scope === "string" ? json.scope : null,
    tokenType: typeof json.token_type === "string" ? json.token_type : null,
    raw: json,
  };
}

/**
 * Whether a token should be refreshed before use. A token with a minute or
 * less left counts as expired, so a request never starts with a token that
 * dies halfway. An unknown expiry is trusted until the provider refuses it.
 */
export function needsRefresh(expiresAt: string | null | undefined, now: Date = new Date(), skewMs = 60_000): boolean {
  if (!expiresAt) return false;
  const t = Date.parse(expiresAt);
  if (!Number.isFinite(t)) return true;
  return t - now.getTime() <= skewMs;
}

/** The secrets to save for a token set, keeping the old refresh token when a refresh didn't send a new one. */
export function tokenSecrets(tokens: TokenSet, previousRefreshToken?: string | null): Record<string, string> {
  const out: Record<string, string> = { access_token: tokens.accessToken };
  const refresh = tokens.refreshToken ?? previousRefreshToken ?? "";
  if (refresh) out.refresh_token = refresh;
  if (tokens.expiresAt) out.access_expires_at = tokens.expiresAt;
  if (tokens.refreshExpiresAt) out.refresh_expires_at = tokens.refreshExpiresAt;
  return out;
}
