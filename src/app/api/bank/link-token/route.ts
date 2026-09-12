import { NextResponse, type NextRequest } from "next/server";

import { getCurrentProfile } from "@/lib/data/team";
import { getCurrentOrganization } from "@/lib/data/organizations";
import { createAdminClient } from "@/lib/supabase/admin";
import { isPlaidConfigured, isSupabaseAdminConfigured } from "@/lib/env";
import { createLinkToken } from "@/lib/plaid";
import { selfBaseUrl } from "@/lib/gis-import-run";

/**
 * A token for Plaid's window, for the signed-in person. With a link id
 * the window redoes a login that has lapsed on that link instead of
 * starting a new one.
 */
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const profile = await getCurrentProfile();
  if (!profile) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if (!isPlaidConfigured) return NextResponse.json({ error: "PLAID_CLIENT_ID and PLAID_SECRET are not set on the server." }, { status: 503 });
  if (!isSupabaseAdminConfigured) return NextResponse.json({ error: "SUPABASE_SERVICE_ROLE_KEY is not set on the server." }, { status: 503 });

  const body = (await request.json().catch(() => ({}))) as { linkId?: string };
  let accessToken: string | undefined;
  if (body.linkId) {
    const admin = createAdminClient();
    const { data: link } = await admin.from("bank_links").select("access_token, organization_id").eq("id", body.linkId).maybeSingle();
    if (!link || link.organization_id !== profile.organization_id) return NextResponse.json({ error: "That bank link is not yours." }, { status: 404 });
    accessToken = link.access_token;
  }

  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? "";
  const proto = request.headers.get("x-forwarded-proto") ?? "https";
  const base = selfBaseUrl(host ? `${proto}://${host}` : "");
  try {
    const org = await getCurrentOrganization();
    const token = await createLinkToken({ userId: profile.id, orgName: org.name, webhookUrl: base ? `${base}/api/webhooks/plaid` : null, accessToken });
    return NextResponse.json({ linkToken: token }, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    const e = err as { response?: { data?: { error_message?: string } }; message?: string };
    const message = e?.response?.data?.error_message ?? e?.message ?? String(err);
    console.error("[bank] link token failed:", message);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
