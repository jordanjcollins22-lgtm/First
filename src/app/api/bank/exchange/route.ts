import { NextResponse, type NextRequest } from "next/server";
import { revalidatePath } from "next/cache";

import { getCurrentProfile } from "@/lib/data/team";
import { createAdminClient } from "@/lib/supabase/admin";
import { isPlaidConfigured, isSupabaseAdminConfigured } from "@/lib/env";
import { exchangePublicToken, syncLink, type BankLinkRow } from "@/lib/plaid";

/**
 * The bank is linked: Plaid's public token becomes the token the app
 * keeps, the link is recorded, and the accounts and six months of
 * transactions are read at once so the pulse has the cash before the
 * page reloads.
 */
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const profile = await getCurrentProfile();
  if (!profile) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if (!isPlaidConfigured || !isSupabaseAdminConfigured) return NextResponse.json({ error: "The bank link is not configured on the server." }, { status: 503 });

  const body = (await request.json().catch(() => ({}))) as { publicToken?: string; institution?: { institution_id?: string; name?: string } | null };
  if (!body.publicToken) return NextResponse.json({ error: "No token came back from the bank." }, { status: 400 });

  const admin = createAdminClient();
  try {
    const { accessToken, itemId } = await exchangePublicToken(body.publicToken);
    const stamp = new Date().toISOString();
    const { data: link, error } = await admin
      .from("bank_links")
      .upsert(
        {
          organization_id: profile.organization_id,
          item_id: itemId,
          access_token: accessToken,
          institution_id: body.institution?.institution_id ?? null,
          institution_name: body.institution?.name ?? null,
          status: "ok",
          last_error: null,
          linked_by: profile.id,
          updated_at: stamp,
        },
        { onConflict: "item_id" }
      )
      .select("*")
      .single();
    if (error) throw error;
    const result = await syncLink(admin, link as BankLinkRow);
    const { error: refreshError } = await admin.rpc("summary_refresh", { org: profile.organization_id, the_key: "ops_pulse" });
    if (refreshError) console.error("[bank] pulse refresh after link:", refreshError.message);
    for (const page of ["/my-day", "/dashboard"]) revalidatePath(page);
    return NextResponse.json({ ok: true, institution: body.institution?.name ?? null, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[bank] exchange failed:", message);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
