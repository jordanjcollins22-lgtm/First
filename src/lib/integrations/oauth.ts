import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";

import { outboundBaseUrl } from "@/lib/base-url";
import { env } from "@/lib/env";
import { getRealProfile } from "@/lib/data/team";
import { getIntegration, saveIntegration } from "@/lib/integrations/store";
import {
  buildAuthorizeUrl,
  needsRefresh,
  parseTokenResponse,
  pkcePair,
  randomState,
  tokenRequest,
  tokenSecrets,
  type OAuthClientConfig,
  type TokenSet,
} from "@/lib/integrations/oauth-core";
import { log } from "@/lib/log";
import { isOwnerLevel } from "@/lib/roles";

export type { OAuthClientConfig, TokenSet } from "@/lib/integrations/oauth-core";
export { needsRefresh, parseTokenResponse, pkcePair, pkceChallenge, buildAuthorizeUrl } from "@/lib/integrations/oauth-core";

/**
 * Generic "Connect" for any provider that signs in with OAuth 2.0
 * (QuickBooks, Google, …). Server only.
 *
 * A provider's two routes become a few lines each:
 *
 *   // src/app/api/integrations/<id>/start/route.ts
 *   export const GET = () => oauthStart({ provider: "<id>", configFor });
 *   // src/app/api/integrations/<id>/callback/route.ts
 *   export const GET = (req: NextRequest) => oauthCallback(req, { provider: "<id>", configFor });
 *
 * and anything that calls the provider's API asks for a token with
 * `accessTokenFor(orgId, "<id>", configFor)`, which refreshes it when it is
 * about to run out and saves the new one, refresh token included, in the
 * integration's secrets. The client id and secret usually come from the
 * same saved secrets, typed in on the Integrations page before Connect.
 */

/**
 * Builds the provider's OAuth settings from what is saved for it. Return a
 * string instead to say what is missing ("Save the Client ID first.").
 */
export type OAuthConfigResolver = (input: {
  organizationId: string;
  secrets: Record<string, string>;
  settings: Record<string, unknown>;
  redirectUri: string;
}) => OAuthClientConfig | string;

/** Where the callback for a provider lives. Register exactly this with the provider. */
export function redirectUriFor(base: string, provider: string): string {
  return `${base.replace(/\/$/, "")}/api/integrations/${provider}/callback`;
}

/** Where the owner lands after connecting: the Integrations card on Admin › Settings. */
export const DEFAULT_RETURN_TO = "/v2/admin";

const cookieName = (provider: string) => `oauth_${provider.replace(/[^a-z0-9_]/gi, "_")}`;
const cookiePath = (provider: string) => `/api/integrations/${provider}`;

interface OAuthOptions {
  provider: string;
  configFor: OAuthConfigResolver;
  /** Path to send the owner back to; defaults to the new layout's Admin page. */
  returnTo?: string;
}

async function resolve(organizationId: string, provider: string, configFor: OAuthConfigResolver) {
  const base = (await outboundBaseUrl()).replace(/\/$/, "");
  const row = await getIntegration(organizationId, provider);
  const config = configFor({
    organizationId,
    secrets: row?.secrets ?? {},
    settings: row?.settings ?? {},
    redirectUri: redirectUriFor(base, provider),
  });
  return { base, row, config };
}

/** The "Connect" button's route: checks the owner, remembers state (and PKCE), and sends them to sign in. */
export async function oauthStart({ provider, configFor, returnTo = DEFAULT_RETURN_TO }: OAuthOptions): Promise<NextResponse> {
  const base = (await outboundBaseUrl()).replace(/\/$/, "");
  const back = (q: string) => NextResponse.redirect(`${base}${returnTo}?integration=${encodeURIComponent(provider)}&${q}`);

  const me = await getRealProfile();
  if (!me) return NextResponse.redirect(`${base}/login`);
  if (!isOwnerLevel(me.roles)) return back(`error=${encodeURIComponent("Only an owner can connect this.")}`);

  const { config } = await resolve(me.organization_id, provider, configFor);
  if (typeof config === "string") return back(`error=${encodeURIComponent(config)}`);

  const state = randomState();
  const pkce = config.pkce ? pkcePair() : null;
  (await cookies()).set(cookieName(provider), JSON.stringify({ state, verifier: pkce?.verifier ?? null }), {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: cookiePath(provider),
    maxAge: 600,
  });
  return NextResponse.redirect(buildAuthorizeUrl(config, state, pkce?.challenge));
}

/** Swaps an authorization code for tokens. */
export async function exchangeCode(config: OAuthClientConfig, code: string, verifier?: string | null): Promise<TokenSet> {
  const params: Record<string, string> = { grant_type: "authorization_code", code, redirect_uri: config.redirectUri };
  if (verifier) params.code_verifier = verifier;
  return postToken(config, params);
}

/** Uses a refresh token to get a new access token (and, at Intuit, a new refresh token). */
export async function refreshTokens(config: OAuthClientConfig, refreshToken: string): Promise<TokenSet> {
  return postToken(config, { grant_type: "refresh_token", refresh_token: refreshToken });
}

async function postToken(config: OAuthClientConfig, params: Record<string, string>): Promise<TokenSet> {
  const { headers, body } = tokenRequest(config, params);
  const res = await fetch(config.tokenUrl, { method: "POST", headers, body, cache: "no-store" });
  const text = await res.text();
  let json: Record<string, unknown> = {};
  try {
    json = JSON.parse(text) as Record<string, unknown>;
  } catch {
    json = { error: text.slice(0, 200) || `HTTP ${res.status}` };
  }
  if (!res.ok) throw new Error(String(json.error_description ?? json.error ?? `HTTP ${res.status}`));
  return parseTokenResponse(json);
}

export interface CallbackOptions extends OAuthOptions {
  /**
   * Runs after the tokens are in hand, before they are saved. Return settings
   * to keep with the connection (Intuit's realmId, the Google account's email).
   */
  onTokens?: (input: {
    organizationId: string;
    tokens: TokenSet;
    params: URLSearchParams;
  }) => Promise<Record<string, unknown> | void>;
}

/** The callback route: checks state, swaps the code, saves the tokens and marks the integration connected. */
export async function oauthCallback(request: NextRequest, opts: CallbackOptions): Promise<NextResponse> {
  const { provider, configFor, onTokens, returnTo = DEFAULT_RETURN_TO } = opts;
  const base = (await outboundBaseUrl()).replace(/\/$/, "");
  const back = (q: string) => NextResponse.redirect(`${base}${returnTo}?integration=${encodeURIComponent(provider)}&${q}`);
  const fail = (problem: string) => back(`error=${encodeURIComponent(problem)}`);

  const jar = await cookies();
  let saved: { state?: string; verifier?: string | null } = {};
  try {
    saved = JSON.parse(jar.get(cookieName(provider))?.value ?? "{}");
  } catch {
    saved = {};
  }
  jar.delete({ name: cookieName(provider), path: cookiePath(provider) });

  const params = request.nextUrl.searchParams;
  if (params.get("error")) return fail(params.get("error_description") ?? "Sign-in was cancelled.");
  const code = params.get("code");
  if (!code || !saved.state || params.get("state") !== saved.state) return fail("That sign-in didn't start here. Press Connect again.");

  const me = await getRealProfile();
  if (!me) return NextResponse.redirect(`${base}/login`);
  if (!isOwnerLevel(me.roles)) return fail("Only an owner can connect this.");
  const orgId = me.organization_id;

  const { config } = await resolve(orgId, provider, configFor);
  if (typeof config === "string") return fail(config);

  try {
    const tokens = await exchangeCode(config, code, saved.verifier);
    const extra = (await onTokens?.({ organizationId: orgId, tokens, params })) ?? {};
    await saveIntegration(orgId, provider, {
      secrets: tokenSecrets(tokens),
      settings: { ...extra, scope: tokens.scope, connected_by: me.id },
      status: "connected",
      lastError: null,
      updatedBy: me.id,
    });
    return back("connected=1");
  } catch (err) {
    const message = err instanceof Error ? err.message : "Couldn't finish connecting.";
    log.error("integration.oauth.callback_failed", err, { provider });
    await saveIntegration(orgId, provider, { status: "error", lastError: message, updatedBy: me.id }).catch(() => undefined);
    return fail(message);
  }
}

/**
 * A working access token for the provider, refreshed and saved when it is
 * about to expire. Null when the provider isn't connected or the refresh was
 * refused, in which case the integration is marked "error" so the
 * Integrations page shows it needs reconnecting. Never throws.
 */
export async function accessTokenFor(
  organizationId: string,
  provider: string,
  configFor: OAuthConfigResolver
): Promise<string | null> {
  try {
    const row = await getIntegration(organizationId, provider);
    if (!row || row.status === "not_connected") return null;
    const access = row.secrets.access_token;
    const refresh = row.secrets.refresh_token;
    if (access && !needsRefresh(row.secrets.access_expires_at)) return access;
    if (!refresh) return access || null;

    // A refresh doesn't send the redirect address, and this may run outside
    // a request (a cron), so a missing host is not a reason to fail.
    const base = await outboundBaseUrl().catch(() => env.appUrl || "");
    const config = configFor({
      organizationId,
      secrets: row.secrets,
      settings: row.settings,
      redirectUri: redirectUriFor(base, provider),
    });
    if (typeof config === "string") return null;
    try {
      const tokens = await refreshTokens(config, refresh);
      await saveIntegration(organizationId, provider, {
        secrets: tokenSecrets(tokens, refresh),
        status: "connected",
        lastError: null,
      });
      return tokens.accessToken;
    } catch (err) {
      const message = `Sign-in expired — press Connect again. (${err instanceof Error ? err.message : "refresh refused"})`;
      log.warn("integration.oauth.refresh_failed", { provider, message });
      await saveIntegration(organizationId, provider, { status: "error", lastError: message }).catch(() => undefined);
      return null;
    }
  } catch (err) {
    log.error("integration.oauth.token_failed", err, { provider });
    return null;
  }
}
