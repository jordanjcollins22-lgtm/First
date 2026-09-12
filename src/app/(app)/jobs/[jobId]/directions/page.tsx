import { notFound } from "next/navigation";

import { isSupabaseConfigured } from "@/lib/env";
import { requireJobAccess } from "@/lib/data/access";
import { createClient } from "@/lib/supabase/server";
import { SetupRequiredNotice } from "@/components/setup-required-notice";
import { DirectionsView } from "@/components/directions/directions-view";

/**
 * The way to one job, without leaving the app.
 *
 * Guarded like the job page itself rather than by a tab: it is a view of one
 * property's address, which anybody who can open that job can already see.
 */
export default async function DirectionsPage({ params }: { params: Promise<{ jobId: string }> }) {
  if (!isSupabaseConfigured) return <SetupRequiredNotice />;
  const { jobId } = await params;

  await requireJobAccess(jobId, ["job-detail", "project-data", "evaluations", "pipeline"]);

  const supabase = await createClient();
  const { data } = await supabase
    .from("jobs")
    .select("id, name, property:properties(address, lat, lng, customers(name))")
    .eq("id", jobId)
    .maybeSingle();

  const job = data as unknown as {
    id: string;
    name: string;
    property: { address: string; lat: number | null; lng: number | null; customers: { name: string } | null } | null;
  } | null;
  if (!job) notFound();

  return (
    <DirectionsView
      destination={{
        jobId,
        address: job.property?.address ?? job.name,
        customerName: job.property?.customers?.name ?? "Client",
        lat: job.property?.lat ?? null,
        lng: job.property?.lng ?? null,
      }}
      back={{ href: `/jobs/${jobId}`, label: "Back to the job" }}
    />
  );
}
