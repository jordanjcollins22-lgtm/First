import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { getCurrentProfile } from "@/lib/data/team";
import { getMetaSecrets } from "@/lib/data/meta";
import { isOwnerLevel } from "@/lib/roles";
import { outboundBaseUrl } from "@/lib/base-url";
import { loginDialogUrl } from "@/lib/meta/graph";
import { resultPage } from "@/lib/meta/result-page";

/**
 * "Connect Facebook page": off to Facebook to pick the page, and back to
 * /api/meta/callback. The state is a random value kept in a cookie, so a
 * callback that did not start here is refused.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const base = (await outboundBaseUrl()).replace(/\/$/, "");
  const profile = await getCurrentProfile();
  if (!profile) return NextResponse.redirect(`${base}/login`);
  if (!isOwnerLevel(profile.roles)) return resultPage("Only an owner can connect the Facebook page.", false);

  const secrets = await getMetaSecrets(profile.organization_id);
  if (!secrets) return resultPage("Save the Meta App ID and App secret in the lead finder's Posts tab first.", false);

  const state = randomBytes(24).toString("hex");
  (await cookies()).set("meta_oauth_state", state, { httpOnly: true, secure: true, sameSite: "lax", path: "/api/meta", maxAge: 600 });
  return NextResponse.redirect(loginDialogUrl({ appId: secrets.appId, redirectUri: `${base}/api/meta/callback`, state, configId: secrets.loginConfigId }));
}
