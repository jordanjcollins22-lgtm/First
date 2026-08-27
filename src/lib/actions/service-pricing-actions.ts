"use server";

import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { getCurrentOrganizationId } from "@/lib/data/organizations";
import { priceFromCogs } from "@/lib/pricing";
import type { PricingBasis } from "@/types/domain";

/**
 * Returns a result rather than throwing. This is called from inline
 * onChange/onBlur handlers inside startTransition — an error thrown there is
 * unhandled and takes the whole page down with a reload prompt, and its
 * message is stripped in production anyway.
 */
export async function updateServicePricing(
  serviceTypeId: string,
  cost: number | null,
  costUnit: string,
  estimatedHours: number | null,
  pricingBasis?: PricingBasis
): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    const organizationId = await getCurrentOrganizationId();
    const supabase = await createClient();
    const { error } = await supabase.from("services").upsert({
      organization_id: organizationId,
      service_type_id: serviceTypeId,
      cost,
      cost_unit: costUnit || "flat rate",
      estimated_hours: estimatedHours,
      ...(pricingBasis ? { pricing_basis: pricingBasis } : {}),
    });
    if (error) {
      return { ok: false, message: `${error.message}${error.code ? ` (${error.code})` : ""}` };
    }

    revalidatePath("/admin/team");
    revalidatePath("/canvas");
    return { ok: true };
  } catch (err) {
    console.error("updateServicePricing failed:", err);
    const message = err instanceof Error ? err.message : String(err ?? "");
    return { ok: false, message: message || "Couldn't save that pricing change." };
  }
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

/** General "how we do this service" writeup, shown to the crew alongside the tool checklist. */
export async function updateServiceHowTo(serviceTypeId: string, howTo: string | null) {
  const supabase = await createClient();
  const { error } = await supabase.from("services").update({ how_to: howTo }).eq("service_type_id", serviceTypeId);
  if (error) throw error;

  revalidatePath("/admin/team");
  revalidatePath("/canvas");
}

/**
 * What a client is told this service covers, on their proposal.
 *
 * Separate from how_to, which is the crew's method. A client reading "edge
 * the bed first, clear debris, lay fabric" is reading an instruction sheet,
 * not a description of what they are buying — and a business that had only
 * one field for both ended up sending one of them to the wrong audience.
 */
export async function updateServiceScopeTemplate(
  serviceTypeId: string,
  scopeTemplate: string | null
) {
  const supabase = await createClient();
  const { error } = await supabase
    .from("services")
    .update({ scope_template: scopeTemplate })
    .eq("service_type_id", serviceTypeId);
  if (error) throw error;

  revalidatePath("/admin/service-pricing");
  revalidatePath("/canvas");
}

/**
 * Whether our own crew does this service, or a partner business does.
 *
 * Decides what a client is told about who will be standing on their property,
 * so it is set at the service level: we do the mulch, somebody else does the
 * tree work, and one flat answer for the whole business is wrong either way.
 */
export async function updateServicePerformedBy(
  serviceTypeId: string,
  performedBy: "own" | "partner",
  partnerName: string | null
) {
  const supabase = await createClient();
  const { error } = await supabase
    .from("services")
    .update({
      performed_by: performedBy,
      // Clearing the flag clears the name with it. A stale partner name on a
      // service we have taken back in house is a name that reappears on a
      // proposal the day somebody flips it again.
      partner_name: performedBy === "partner" ? partnerName?.trim() || null : null,
    })
    .eq("service_type_id", serviceTypeId);
  if (error) throw error;

  revalidatePath("/admin/service-pricing");
  revalidatePath("/canvas");
}

/**
 * How long one sq ft takes and how many people work it — together the labor
 * half of the COGS calculator (minutes x crew size = paid crew-minutes).
 */
export async function updateServiceLabor(
  serviceTypeId: string,
  minutesPerSqft: number | null,
  crewSize: number
) {
  const supabase = await createClient();
  const { error } = await supabase
    .from("services")
    .update({ minutes_per_sqft: minutesPerSqft, crew_size: Math.max(1, Math.round(crewSize)) })
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
  const hoursRaw = String(formData.get("estimated_hours") ?? "").trim();

  // Default to the business's own measurement unit rather than a flat rate —
  // per-unit pricing is the point of the COGS calculator.
  const { data: org } = await supabase
    .from("organizations")
    .select("measurement_unit")
    .eq("id", organizationId)
    .maybeSingle();
  const costUnit =
    String(formData.get("cost_unit") ?? "").trim() || `per ${org?.measurement_unit ?? "sq ft"}`;

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
