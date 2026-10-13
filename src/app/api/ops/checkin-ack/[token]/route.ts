import { NextResponse, type NextRequest } from "next/server";

import { isSupabaseAdminConfigured } from "@/lib/env";
import { admin } from "@/lib/data/ops-settings";

/**
 * "On it": the project lead's one tap from the morning check-in text.
 *
 * No sign-in, because the lead is standing in a yard with a phone and the
 * point is that answering costs one tap. The token in the link is the whole
 * of the access, and all it can do is stop this one alert going to the owner.
 *
 * A GET shows a button and a POST records it, because phones and link
 * checkers open links on their own, and a preview must not answer for the lead.
 */
export const dynamic = "force-dynamic";

const page = (title: string, body: string, form = "") => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>body{font:16px/1.5 system-ui,-apple-system,Segoe UI,sans-serif;margin:0;padding:24px;color:#111;background:#fff}
main{max-width:28rem;margin:0 auto}button{min-height:44px;width:100%;font:inherit;font-weight:600;border:0;border-radius:12px;background:#166534;color:#fff;padding:12px}
@media (prefers-color-scheme: dark){body{background:#0b0b0b;color:#eee}}</style></head>
<body><main><h1 style="font-size:1.25rem">${title}</h1><p>${body}</p>${form}</main></body></html>`;

const html = (s: string, status = 200) => new NextResponse(s, { status, headers: { "content-type": "text/html; charset=utf-8" } });

export async function GET(_request: NextRequest, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params;
  if (!isSupabaseAdminConfigured || !/^[0-9a-f]{32}$/.test(token)) return html(page("Link not valid", "This link isn't valid."), 400);
  const { data } = await admin().from("crew_checkin_alerts").select("acknowledged_at, escalated_at").eq("token", token).maybeSingle();
  if (!data) return html(page("Link not valid", "This link isn't valid."), 404);
  const row = data as { acknowledged_at: string | null; escalated_at: string | null };
  if (row.acknowledged_at) return html(page("Got it", "You already said you're on it. Thanks."));
  return html(
    page(
      "Are you on it?",
      row.escalated_at ? "The owner has already been told, but say so and they'll know you're handling it." : "Tap below and the owner won't be texted about this.",
      `<form method="post"><button type="submit">I'm on it</button></form>`
    )
  );
}

export async function POST(_request: NextRequest, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params;
  if (!isSupabaseAdminConfigured || !/^[0-9a-f]{32}$/.test(token)) return html(page("Link not valid", "This link isn't valid."), 400);
  const db = admin();
  const { data } = await db.from("crew_checkin_alerts").select("id, lead_id, acknowledged_at").eq("token", token).maybeSingle();
  if (!data) return html(page("Link not valid", "This link isn't valid."), 404);
  const row = data as { id: string; lead_id: string | null; acknowledged_at: string | null };
  if (!row.acknowledged_at) {
    await db
      .from("crew_checkin_alerts")
      .update({ acknowledged_at: new Date().toISOString(), acknowledged_by: row.lead_id })
      .eq("id", row.id)
      .is("acknowledged_at", null);
  }
  return html(page("Got it", "Thanks. The owner won't be texted about this one."));
}
