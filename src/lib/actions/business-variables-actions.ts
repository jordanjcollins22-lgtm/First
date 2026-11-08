"use server";

import { revalidatePath } from "next/cache";

import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentProfile } from "@/lib/data/team";
import { isOwnerLevel } from "@/lib/roles";
import { refuseInDemo } from "@/lib/demo-mode";
import { readVariables } from "@/lib/pricing-variables";

type Result = { ok: true; savedAt: string } | { ok: false; error: string };

/**
 * Saves every variable on Admin › Variables at once. Owners and admins only:
 * every project price and every crew member's pay is worked out from them.
 * What is saved is what readVariables makes of it, so a figure out of range
 * is kept at its starting value rather than stored.
 */
export async function saveBusinessVariables(input: unknown): Promise<Result> {
  await refuseInDemo();
  const profile = await getCurrentProfile();
  if (!profile) return { ok: false, error: "Sign in first." };
  if (!isOwnerLevel(profile.roles) && !profile.roles.includes("admin")) return { ok: false, error: "Only an owner or admin can change the variables." };
  const variables = readVariables(input);
  const savedAt = new Date().toISOString();
  const { error } = await createAdminClient()
    .from("business_variables" as never)
    .upsert({ organization_id: profile.organization_id, variables, updated_at: savedAt, updated_by: profile.id } as never);
  if (error) {
    console.error("[business-variables] save failed:", error.message);
    return { ok: false, error: /business_variables/.test(error.message) ? "This can't be saved until database update 0371 is applied." : "Couldn't save that. Try again." };
  }
  revalidatePath("/admin/variables");
  return { ok: true, savedAt };
}
