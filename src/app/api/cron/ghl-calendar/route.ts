import { NextResponse, type NextRequest } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { isSupabaseAdminConfigured } from "@/lib/env";
import { authorizeCron } from "@/lib/cron-auth";
import { isGhlConfigured } from "@/lib/ghl/client";
import { pullGhlCalendar } from "@/lib/ghl/inbound";

/**
 * The daily read of the GoHighLevel calendar.
 *
 * The backstop. The same read happens whenever somebody opens the Calendar
 * or My Day, so a booking made in GoHighLevel is usually here within
 * minutes; this is for the day nobody opens the app.
 */
export async function GET(request: NextRequest) {
  if (!isSupabaseAdminConfigured) {
    return NextResponse.json({ error: "Supabase admin isn't configured." }, { status: 503 });
  }
  const refused = authorizeCron(request, "ghl-calendar");
  if (refused) return refused;
  if (!isGhlConfigured) return NextResponse.json({ ok: true, skipped: "GoHighLevel is not set up." });

  const admin = createAdminClient();
  const { data: orgs, error } = await admin.from("organizations").select("id");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const report: Record<string, string> = {};
  for (const org of orgs ?? []) {
    const result = await pullGhlCalendar(org.id);
    report[org.id] = result.summary;
  }
  return NextResponse.json({ ok: true, report });
}
