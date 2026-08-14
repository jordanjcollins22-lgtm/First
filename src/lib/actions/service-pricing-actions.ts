"use server";

import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { getCurrentOrganizationId } from "@/lib/data/organizations";
import { priceFromCogs } from "@/lib/pricing";

export async function updateServicePricing(
  serviceTypeId: string,
  cost: number | null,
  costUnit: string,
  estimatedHours: number | null
) {
  const organizationId = await getCurrentOrganizationId();
  const supabase = await createClient();
  const { error } = await supabase.from("services").upsert({
    organization_id: organizationId,
    service_type_id: serviceTypeId,
    cost,
    cost_unit: costUnit || "flat rate",
    estimated_hours: estimatedHours,
  });
  if (error) throw error;

  revalidatePath("/admin/team");
  revalidatePath("/canvas");
}

/** COGS x 2 (50% gross margin) + 10% buffer — recalculates and saves the sale price from a COGS entry. */
export async function updateServiceCogs(serviceTypeId: string, cogs: number | null, costUnit?: string) {
  const supabase = await createClient();
  const { error } = await supabase
    .from("services")
    .update({
      cogs,
      cost: cogs != null ? priceFromCogs(cogs) : null,
      ...(costUnit ? { cost_unit: costUnit } : {}),
    })
    .eq("service_type_id", serviceTypeId);
  if (error) throw error;

  revalidatePath("/admin/team");
  revalidatePath("/canvas");
}

/** How long one sq ft of this service takes — the labor half of the COGS calculator. */
export async function updateServiceMinutesPerSqft(serviceTypeId: string, minutesPerSqft: number | null) {
  const supabase = await createClient();
  const { error } = await supabase
    .from("services")
    .update({ minutes_per_sqft: minutesPerSqft })
    .eq("service_type_id", serviceTypeId);
  if (error) throw error;

  revalidatePath("/admin/team");
  revalidatePath("/canvas");
}

/** Admin adds a service directly — it's immediately pickable for quotes. */
export async function createServiceType(formData: FormData) {
  const organizationId = await getCurrentOrganizationId();
  const supabase = await createClient();

  const name = String(formData.get("name") ?? "").trim();
  if (!name) throw new Error("Enter a service name.");

  const cogsRaw = String(formData.get("cogs") ?? "").trim();
  const cogs = cogsRaw ? Number(cogsRaw) : null;
  const costRaw = String(formData.get("cost") ?? "").trim();
  const costUnit = String(formData.get("cost_unit") ?? "").trim() || "flat rate";
  const hoursRaw = String(formData.get("estimated_hours") ?? "").trim();

  const { error } = await supabase.from("services").insert({
    organization_id: organizationId,
    service_type_id: `custom-${randomUUID()}`,
    name,
    status: "active",
    cogs,
    cost: cogs != null ? priceFromCogs(cogs) : costRaw ? Number(costRaw) : null,
    cost_unit: costUnit,
    estimated_hours: hoursRaw ? Number(hoursRaw) : null,
  });
  if (error) throw error;

  revalidatePath("/admin/team");
  revalidatePath("/canvas");
}

/** Team member proposes a service mid-quote — sits pending until an admin prices it or declines it. */
export async function proposeServiceType(name: string, note: string): Promise<{ serviceTypeId: string; name: string }> {
  const organizationId = await getCurrentOrganizationId();
  const supabase = await createClient();

  const trimmed = name.trim();
  if (!trimmed) throw new Error("Enter a service name.");

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const serviceTypeId = `custom-${randomUUID()}`;
  const { error } = await supabase.from("services").insert({
    organization_id: organizationId,
    service_type_id: serviceTypeId,
    name: trimmed,
    status: "pending",
    requested_by: user?.id ?? null,
    requested_note: note.trim() || null,
    cost_unit: "flat rate",
  });
  if (error) throw error;

  revalidatePath("/admin/team");
  return { serviceTypeId, name: trimmed };
}

/** Admin accepts a proposed service, setting its price (via COGS or a direct cost) so it becomes active. */
export async function acceptServiceType(
  serviceTypeId: string,
  cogs: number | null,
  cost: number | null,
  costUnit: string,
  estimatedHours: number | null
) {
  const supabase = await createClient();
  const { error } = await supabase
    .from("services")
    .update({
      status: "active",
      cogs,
      cost: cogs != null ? priceFromCogs(cogs) : cost,
      cost_unit: costUnit || "flat rate",
      estimated_hours: estimatedHours,
    })
    .eq("service_type_id", serviceTypeId);
  if (error) throw error;

  revalidatePath("/admin/team");
  revalidatePath("/canvas");
}

/** Admin declines a proposed service — jobs using it show "outside our scope" instead of a price. */
export async function denyServiceType(serviceTypeId: string) {
  const supabase = await createClient();
  const { error } = await supabase.from("services").update({ status: "denied" }).eq("service_type_id", serviceTypeId);
  if (error) throw error;

  revalidatePath("/admin/team");
  revalidatePath("/canvas");
}
