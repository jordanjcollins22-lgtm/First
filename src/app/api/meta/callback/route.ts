import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";

import { getCurrentProfile } from "@/lib/data/team";
import { getMetaSecrets, saveMetaSettings, syncMetaPages } from "@/lib/data/meta";
import { isOwnerLevel } from "@/lib/roles";
import { outboundBaseUrl } from "@/lib/base-url";
import { GraphError, subscribeApp, userTokenFromCode } from "@/lib/meta/graph";
import { log } from "@/lib/log";

/**
 * Where Facebook sends the owner back after they pick their pages.
 *
 * Swaps the code for a key that lasts about 60 days, keeps it so "Refresh
 * pages" works later, fetches every page with its own key (those don't
 * expire), switches message delivery on for each, and points the whole app's
 * messages at /api/webhooks/meta. Then back to the admin page to say how it went.
 */
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const base = (await outboundBaseUrl()).replace(/\/$/, "");
  const done = (query: string) => NextResponse.redirect(`${base}/admin/meta?${query}`);
  const fail = (problem: string) => done(`error=${encodeURIComponent(problem)}`);

  const jar = await cookies();
  const expected = jar.get("meta_oauth_state")?.value;
  jar.delete({ name: "meta_oauth_state", path: "/api/meta" });

  const params = request.nextUrl.searchParams;
  if (params.get("error")) return fail(params.get("error_description") ?? "Facebook login was cancelled.");
  const code = params.get("code");
  if (!code || !expected || params.get("state") !== expected) return fail("That login didn't start here. Press Connect Facebook again.");

  const profile = await getCurrentProfile();
  if (!profile) return NextResponse.redirect(`${base}/login`);
  if (!isOwnerLevel(profile.roles)) return fail("Only an owner can connect Facebook.");
  const orgId = profile.organization_id;

  const secrets = await getMetaSecrets(orgId);
  if (!secrets) return fail("Save the App ID and App secret first.");

  try {
    const userToken = await userTokenFromCode({
      appId: secrets.appId,
      appSecret: secrets.appSecret,
      redirectUri: `${base}/api/meta/callback`,
      code,
    });
    await saveMetaSettings(orgId, {
      user_token: userToken,
      connected_by: profile.id,
      connected_at: new Date().toISOString(),
      last_error: null,
    });
    const { pages, failed } = await syncMetaPages(orgId, userToken);
    if (pages === 0) return fail("Facebook gave no pages. On the Facebook screen, choose your business page and allow every permission.");

    try {
      await subscribeApp({
        appId: secrets.appId,
        appSecret: secrets.appSecret,
        callbackUrl: `${base}/api/webhooks/meta`,
        verifyToken: secrets.verifyToken,
      });
      await saveMetaSettings(orgId, { webhooks_at: new Date().toISOString() });
    } catch (err) {
      const message = err instanceof GraphError ? err.message : "Couldn't switch on message delivery.";
      log.warn("meta.subscribe_app.failed", { message });
      await saveMetaSettings(orgId, { last_error: `Messages: ${message}` });
      return done(`connected=${pages}&warning=${encodeURIComponent(`Pages are connected, but messages aren't switched on yet. Facebook said: ${message}`)}`);
    }
    return done(`connected=${pages}${failed ? `&failed=${failed}` : ""}`);
  } catch (err) {
    const message = err instanceof GraphError ? `Facebook said: ${err.message}` : "Couldn't finish connecting.";
    log.error("meta.connect.failed", err);
    await saveMetaSettings(orgId, { last_error: message }).catch(() => undefined);
    return fail(message);
  }
}
