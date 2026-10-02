"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/team";
import { isOwnerLevel } from "@/lib/roles";
import { getProductionPricing } from "@/lib/data/production-pricing";

type Result = { ok: true } | { ok: false; message: string };

function refresh(jobId: string) {
  revalidatePath(`/jobs/${jobId}`);
  revalidatePath(`/jobs/${jobId}/work-order`);
}

/** The job's business, read under the person's own sign-in: no row, no access. */
async function jobOrg(jobId: string): Promise<string | null> {
  const supabase = await createClient();
  const { data } = await supabase.from("jobs").select("id, property:properties!inner(customers!inner(organization_id))").eq("id", jobId).maybeSingle();
  return (data as unknown as { property: { customers: { organization_id: string } } } | null)?.property.customers.organization_id ?? null;
}

/** Start timing a service in an area. One running timer per service per area. */
export async function startServiceTimer(jobId: string, input: { zoneId: string; zoneName: string; serviceKey: string; plannedQuantity: number }): Promise<Result> {
  const profile = await getCurrentProfile();
  if (!profile) return { ok: false, message: "Sign in first." };
  const organizationId = await jobOrg(jobId);
  if (!organizationId) return { ok: false, message: "Couldn't find that job." };
  const supabase = await createClient();
  const pricing = await getProductionPricing(supabase, organizationId);
  const service = pricing.services.find((s) => s.key === input.serviceKey);
  if (!service || service.unit === "job") return { ok: false, message: "That service can't be timed." };
  const { data: running } = await supabase
    .from("service_time_logs")
    .select("id")
    .eq("job_id", jobId)
    .eq("zone_id", input.zoneId)
    .eq("service_key", input.serviceKey)
    .is("finished_at", null)
    .limit(1);
  if (running && running.length > 0) return { ok: true };
  const { error } = await supabase.from("service_time_logs").insert({
    organization_id: organizationId,
    job_id: jobId,
    zone_id: input.zoneId.slice(0, 100),
    zone_name: input.zoneName.slice(0, 100),
    service_key: service.key,
    unit: service.unit,
    planned_quantity: Number.isFinite(input.plannedQuantity) ? Math.max(0, input.plannedQuantity) : null,
    started_by: profile.id,
  });
  if (error) return { ok: false, message: /service_time_logs/.test(error.message) ? "Timing isn't switched on yet." : "Couldn't start the timer. Try again." };
  refresh(jobId);
  return { ok: true };
}

/** Stop it: how much got done and how many people were on it. */
export async function finishServiceTimer(jobId: string, logId: string, quantity: number, people: number): Promise<Result> {
  const profile = await getCurrentProfile();
  if (!profile) return { ok: false, message: "Sign in first." };
  if (!Number.isFinite(quantity) || quantity <= 0) return { ok: false, message: "Say how much got done." };
  const crew = Math.round(people);
  if (!Number.isFinite(crew) || crew < 1 || crew > 20) return { ok: false, message: "Say how many people were on it." };
  const supabase = await createClient();
  const { data: log } = await supabase.from("service_time_logs").select("id, started_at, finished_at").eq("id", logId).eq("job_id", jobId).maybeSingle();
  if (!log) return { ok: false, message: "Couldn't find that timer." };
  if (log.finished_at) return { ok: true };
  const now = new Date();
  if (now.getTime() - new Date(log.started_at).getTime() < 60_000) return { ok: false, message: "That was under a minute. Cancel it if it was started by mistake." };
  const { error } = await supabase
    .from("service_time_logs")
    .update({ finished_at: now.toISOString(), quantity, people: crew, finished_by: profile.id })
    .eq("id", logId)
    .is("finished_at", null);
  if (error) return { ok: false, message: "Couldn't stop the timer. Try again." };
  refresh(jobId);
  return { ok: true };
}

/** A timer started by mistake: gone, as if it never ran. Only while it is running. */
export async function cancelServiceTimer(jobId: string, logId: string): Promise<Result> {
  const profile = await getCurrentProfile();
  if (!profile) return { ok: false, message: "Sign in first." };
  const supabase = await createClient();
  const { error } = await supabase.from("service_time_logs").delete().eq("id", logId).eq("job_id", jobId).is("finished_at", null);
  if (error) return { ok: false, message: "Couldn't cancel it. Try again." };
  refresh(jobId);
  return { ok: true };
}

/** Leave one run out of the average, or put it back. Owners and admins. */
export async function setTimeLogExcluded(logId: string, excluded: boolean): Promise<Result> {
  const profile = await getCurrentProfile();
  if (!profile) return { ok: false, message: "Sign in first." };
  if (!isOwnerLevel(profile.roles) && !profile.roles.includes("admin")) return { ok: false, message: "Only an owner or admin can change the averages." };
  const supabase = await createClient();
  const { error } = await supabase.from("service_time_logs").update({ excluded }).eq("id", logId).eq("organization_id", profile.organization_id);
  if (error) return { ok: false, message: "Couldn't save that. Try again." };
  revalidatePath("/admin/production-rates");
  return { ok: true };
}
