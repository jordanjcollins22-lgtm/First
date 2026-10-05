import { NextResponse, type NextRequest } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { isSupabaseAdminConfigured } from "@/lib/env";
import { stopCompany } from "@/lib/data/pm-sender";

/**
 * One-click unsubscribe, for the button mail apps show beside a cold email.
 * A POST is the click itself; a GET (a person following the link) goes to
 * the page that asks first, because link checkers open links too.
 */
export const dynamic = "force-dynamic";

export async function POST(_request: NextRequest, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params;
  if (!isSupabaseAdminConfigured || !/^[0-9a-f]{32}$/.test(token)) return new NextResponse(null, { status: 400 });
  const admin = createAdminClient();
  const { data: company } = await admin.from("pm_companies").select("id").eq("unsubscribe_token", token).maybeSingle();
  if (company) await stopCompany(admin, company.id, "unsubscribed");
  return new NextResponse(null, { status: 200 });
}

export async function GET(request: NextRequest, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params;
  return NextResponse.redirect(new URL(`/stop/${encodeURIComponent(token)}`, request.nextUrl.origin), 303);
}
