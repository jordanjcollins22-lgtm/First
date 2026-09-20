import { NextResponse, type NextRequest } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { isSupabaseAdminConfigured } from "@/lib/env";
import { authorizeCron } from "@/lib/cron-auth";
import { sendDueEvaluationEmails } from "@/lib/data/evaluation-sequence-send";
import { expireStaleApprovals } from "@/lib/data/outbound-approvals";

/**
 * Sends the evaluation email sequence.
 *
 * The database says what is due: which step, for whom, with the words
 * already filled in and the window it is due within. This claims each one
 * so no other run can send it, sends it from the business's Gmail, and
 * records the message id so the next step in the sequence threads under
 * the first. Run it as often as you like; a step is sent once.
 */
export async function GET(request: NextRequest) {
  if (!isSupabaseAdminConfigured) {
    return NextResponse.json({ error: "Supabase admin isn't configured." }, { status: 503 });
  }
  const refused = authorizeCron(request, "evaluation-emails");
  if (refused) return refused;
  const admin = createAdminClient();
  try {
    await expireStaleApprovals(admin).catch(() => 0);
    const { why, ...counts } = await sendDueEvaluationEmails(admin);
    return NextResponse.json({ ok: true, ...counts, ...(why ? { why } : {}) });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
