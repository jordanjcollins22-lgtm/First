import { createAdminClient } from "@/lib/supabase/admin";

export interface PublicFlyerRun {
  runId: string;
  organizationId: string;
  organizationName: string;
  runName: string;
  mailsOn: string | null;
  flyerCount: number;
  spotPriceCents: number;
  /** Spots already paid for on this run. */
  taken: number;
}

/**
 * The run the public link is currently selling.
 *
 * The newest open one, because there is only ever meant to be one taking
 * bookings. Null when the business has not opened a run, which the page says
 * plainly rather than showing an empty form nobody can buy from.
 */
export async function openFlyerRun(orgSlug: string): Promise<PublicFlyerRun | null> {
  const admin = createAdminClient();

  const { data: org } = await admin
    .from("organizations")
    .select("id, name")
    .eq("slug", orgSlug)
    .maybeSingle();
  if (!org) return null;

  const { data: run } = await admin
    .from("flyer_runs")
    .select("id, name, mails_on, flyer_count, spot_price_cents")
    .eq("organization_id", org.id)
    .eq("status", "open")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!run) return null;

  // Paid and placed only. A draft somebody abandoned three weeks ago is not
  // a spot, and counting it would show a run as full while it is empty.
  const { data: sold } = await admin
    .from("flyer_bookings")
    .select("id")
    .eq("run_id", run.id)
    .in("status", ["paid", "placed"]);

  return {
    runId: run.id,
    organizationId: org.id,
    organizationName: org.name,
    runName: run.name,
    mailsOn: run.mails_on,
    flyerCount: run.flyer_count,
    spotPriceCents: run.spot_price_cents,
    taken: sold?.length ?? 0,
  };
}
