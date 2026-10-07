import { NextResponse, type NextRequest } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { isPlaidConfigured, isSupabaseAdminConfigured } from "@/lib/env";
import { syncLink, type BankLinkRow } from "@/lib/plaid";

/**
 * Plaid's word that something changed on a link: new transactions, or a
 * login that has lapsed. The only thing taken from the body is which
 * link, and the only thing done is a read of that link, so a forged call
 * costs a read and nothing else.
 */
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  if (!isPlaidConfigured || !isSupabaseAdminConfigured) return NextResponse.json({ ok: false }, { status: 503 });
  const body = (await request.json().catch(() => ({}))) as { webhook_type?: string; webhook_code?: string; item_id?: string };
  if (!body.item_id) return NextResponse.json({ ok: false, error: "No item." }, { status: 400 });

  const admin = createAdminClient();
  const { data: link } = await admin.from("bank_links").select("*").eq("item_id", body.item_id).maybeSingle();
  if (!link) return NextResponse.json({ ok: true, ignored: "unknown item" });

  if (body.webhook_type === "ITEM" && (body.webhook_code === "ERROR" || body.webhook_code === "PENDING_EXPIRATION" || body.webhook_code === "PENDING_DISCONNECT")) {
    await admin.from("bank_links").update({ status: "needs_relink", last_error: `Plaid: ${body.webhook_code}`, updated_at: new Date().toISOString() }).eq("id", link.id);
    return NextResponse.json({ ok: true, marked: "needs_relink" });
  }
  if (body.webhook_type === "ITEM" && body.webhook_code === "USER_PERMISSION_REVOKED") {
    await admin.from("bank_links").update({ status: "needs_relink", last_error: "The bank's permission was revoked.", updated_at: new Date().toISOString() }).eq("id", link.id);
    return NextResponse.json({ ok: true, marked: "needs_relink" });
  }

  try {
    const result = await syncLink(admin, link as BankLinkRow);
    await admin.rpc("summary_refresh", { org: link.organization_id, the_key: "ops_pulse" });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 200 });
  }
}
