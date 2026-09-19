import { NextResponse, type NextRequest } from "next/server";
import { revalidatePath } from "next/cache";

import { getCurrentProfile } from "@/lib/data/team";
import { createAdminClient } from "@/lib/supabase/admin";
import { isPlaidConfigured, isSupabaseAdminConfigured } from "@/lib/env";
import { removeItem, syncOrganization } from "@/lib/plaid";

/**
 * Read the bank now (POST), or let a link go (DELETE with a linkId): the
 * token is given back to Plaid and the link, its accounts and its
 * transactions are dropped. The bank itself is untouched either way.
 */
export const dynamic = "force-dynamic";

export async function POST() {
  const profile = await getCurrentProfile();
  if (!profile) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if (!isPlaidConfigured || !isSupabaseAdminConfigured) return NextResponse.json({ error: "The bank link is not configured on the server." }, { status: 503 });
  try {
    const result = await syncOrganization(createAdminClient(), profile.organization_id);
    for (const page of ["/my-day", "/dashboard"]) revalidatePath(page);
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

export async function DELETE(request: NextRequest) {
  const profile = await getCurrentProfile();
  if (!profile) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if (!isSupabaseAdminConfigured) return NextResponse.json({ error: "SUPABASE_SERVICE_ROLE_KEY is not set on the server." }, { status: 503 });
  const body = (await request.json().catch(() => ({}))) as { linkId?: string };
  if (!body.linkId) return NextResponse.json({ error: "Which link?" }, { status: 400 });
  const admin = createAdminClient();
  const { data: link } = await admin.from("bank_links").select("id, organization_id, access_token").eq("id", body.linkId).maybeSingle();
  if (!link || link.organization_id !== profile.organization_id) return NextResponse.json({ error: "That bank link is not yours." }, { status: 404 });
  try {
    if (isPlaidConfigured) await removeItem(link.access_token).catch((err) => console.error("[bank] Plaid would not drop the item:", err));
    await admin.from("bank_transactions").delete().eq("organization_id", profile.organization_id).in(
      "account_id",
      ((await admin.from("bank_accounts").select("account_id").eq("link_id", link.id)).data ?? []).map((a) => a.account_id)
    );
    const { error } = await admin.from("bank_links").delete().eq("id", link.id);
    if (error) throw error;
    await admin.rpc("summary_refresh", { org: profile.organization_id, the_key: "ops_pulse" });
    for (const page of ["/my-day", "/dashboard"]) revalidatePath(page);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
