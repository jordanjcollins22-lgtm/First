import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";

import { getCurrentProfile } from "@/lib/data/team";
import { getMetaSecrets, saveMetaSettings, syncMetaPages } from "@/lib/data/meta";
import { isOwnerLevel } from "@/lib/roles";
import { outboundBaseUrl } from "@/lib/base-url";
import { GraphError, userTokenFromCode } from "@/lib/meta/graph";
import { resultPage } from "@/lib/meta/result-page";
import { log } from "@/lib/log";

/**
 * Where Facebook sends the owner back after they pick their page. Swaps the
 * code for a key that lasts about 60 days, then keeps each page with its own
 * key (those don't expire), and says how it went.
 */
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const base = (await outboundBaseUrl()).replace(/\/$/, "");
  const jar = await cookies();
  const expected = jar.get("meta_oauth_state")?.value;
  jar.delete({ name: "meta_oauth_state", path: "/api/meta" });

  const params = request.nextUrl.searchParams;
  if (params.get("error")) return resultPage(params.get("error_description") ?? "Facebook login was cancelled.", false);
  const code = params.get("code");
  if (!code || !expected || params.get("state") !== expected) return resultPage("That login didn't start here. Press Connect Facebook page again.", false);

  const profile = await getCurrentProfile();
  if (!profile) return NextResponse.redirect(`${base}/login`);
  if (!isOwnerLevel(profile.roles)) return resultPage("Only an owner can connect the Facebook page.", false);
  const orgId = profile.organization_id;
  const secrets = await getMetaSecrets(orgId);
  if (!secrets) return resultPage("Save the Meta App ID and App secret first.", false);

  try {
    const userToken = await userTokenFromCode({ appId: secrets.appId, appSecret: secrets.appSecret, redirectUri: `${base}/api/meta/callback`, code });
    await saveMetaSettings(orgId, { user_token: userToken, connected_by: profile.id, connected_at: new Date().toISOString(), last_error: null });
    const pages = await syncMetaPages(orgId, userToken);
    if (pages === 0) return resultPage("Facebook gave no pages. On the Facebook screen, choose the business page and allow every permission.", false);
    return resultPage(`Facebook page connected. Approved posts will be scheduled on it the next time the lead finder runs. You can close this tab.`, true);
  } catch (err) {
    const message = err instanceof GraphError ? `Facebook said: ${err.message}` : "Couldn't finish connecting.";
    log.error("meta.connect.failed", err);
    await saveMetaSettings(orgId, { last_error: message }).catch(() => undefined);
    return resultPage(message, false);
  }
}
