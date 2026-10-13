import { randomBytes, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";

import { outboundBaseUrl } from "@/lib/base-url";
import { getRealProfile } from "@/lib/data/team";
import { findLocation } from "@/lib/google/business";
import { exchangeGoogleCode, GOOGLE_SCOPES, googleAuthUrl, type GoogleProviderId } from "@/lib/google/oauth";
import { getIntegration, saveIntegration } from "@/lib/integrations/store";
import { log } from "@/lib/log";
import { isOwnerLevel } from "@/lib/roles";

/**
 * The two halves of "Connect" for every Google provider, shared by the
 * start and callback routes under /api/integrations/<id>/.
 *
 * The state is a random value kept in a cookie scoped to that provider's
 * routes, so a callback that did not start here is refused. Only an owner,
 * checked against the account actually signed in (not a view-as), can
 * connect anything.
 */

/** Where the owner lands afterwards. */
const RETURN_PATH = "/v2/marketing";

function cookieName(provider: GoogleProviderId) {
  return `google_oauth_${provider}`;
}

async function base() {
  return (await outboundBaseUrl()).replace(/\/$/, "");
}

function back(root: string, provider: GoogleProviderId, params: Record<string, string>) {
  const q = new URLSearchParams({ integration: provider, ...params });
  return NextResponse.redirect(`${root}${RETURN_PATH}?${q.toString()}`);
}

export async function startGoogleOAuth(provider: GoogleProviderId): Promise<NextResponse> {
  const root = await base();
  const me = await getRealProfile();
  if (!me) return NextResponse.redirect(`${root}/login`);
  if (!isOwnerLevel(me.roles)) return back(root, provider, { error: "Only an owner can connect Google." });

  const row = await getIntegration(me.organization_id, provider);
  if (!row?.secrets?.client_id || !row?.secrets?.client_secret) {
    return back(root, provider, { error: "Save the OAuth client ID and secret in Settings › Integrations first." });
  }

  const state = randomBytes(24).toString("hex");
  (await cookies()).set(cookieName(provider), state, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: `/api/integrations/${provider}`,
    maxAge: 600,
  });
  return NextResponse.redirect(
    googleAuthUrl({
      clientId: row.secrets.client_id,
      redirectUri: `${root}/api/integrations/${provider}/callback`,
      scopes: GOOGLE_SCOPES[provider],
      state,
    })
  );
}

function sameState(a: string | undefined, b: string | null): boolean {
  if (!a || !b) return false;
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export async function finishGoogleOAuth(provider: GoogleProviderId, request: NextRequest): Promise<NextResponse> {
  const root = await base();
  const jar = await cookies();
  const expected = jar.get(cookieName(provider))?.value;
  jar.delete({ name: cookieName(provider), path: `/api/integrations/${provider}` });

  const params = request.nextUrl.searchParams;
  if (params.get("error")) return back(root, provider, { error: `Google said: ${params.get("error")}` });
  if (!sameState(expected, params.get("state"))) return back(root, provider, { error: "That sign-in didn't start here. Press Connect again." });

  const me = await getRealProfile();
  if (!me) return NextResponse.redirect(`${root}/login`);
  if (!isOwnerLevel(me.roles)) return back(root, provider, { error: "Only an owner can connect Google." });

  const row = await getIntegration(me.organization_id, provider);
  const code = params.get("code");
  if (!row?.secrets?.client_id || !row.secrets.client_secret || !code) return back(root, provider, { error: "Something was missing. Press Connect again." });

  try {
    const tokens = await exchangeGoogleCode({
      clientId: row.secrets.client_id,
      clientSecret: row.secrets.client_secret,
      code,
      redirectUri: `${root}/api/integrations/${provider}/callback`,
    });
    if (!tokens.refreshToken) {
      return back(root, provider, { error: "Google didn't hand back a lasting sign-in. Remove the app's access in your Google account and press Connect again." });
    }
    await saveIntegration(me.organization_id, provider, {
      secrets: { refresh_token: tokens.refreshToken },
      status: "connected",
      lastError: null,
      updatedBy: me.id,
    });

    // The listing is found once, now, so the first daily run has nothing to discover.
    if (provider === "google_business") {
      const loc = await findLocation(tokens.accessToken, row.secrets.location_id || null);
      if (loc.ok) {
        await saveIntegration(me.organization_id, provider, {
          settings: { account: loc.value.account, location: loc.value.location, location_title: loc.value.title },
        });
      } else {
        await saveIntegration(me.organization_id, provider, { status: "error", lastError: loc.error });
        return back(root, provider, { error: loc.error });
      }
    }
    log.info("google.connected", { provider });
    return back(root, provider, { connected: "1" });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Google refused the sign-in.";
    await saveIntegration(me.organization_id, provider, { status: "error", lastError: message });
    return back(root, provider, { error: message });
  }
}
