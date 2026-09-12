"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/team";
import { getCurrentOrganizationId } from "@/lib/data/organizations";
import type { Discount, DiscountKind } from "@/types/domain";

/** Any team member can add one — an account manager reviewing a proposal
 * shouldn't have to wait on an admin to create the discount they need. */
export async function createDiscount(name: string, kind: DiscountKind, value: number): Promise<Discount> {
  const profile = await getCurrentProfile();
  if (!profile) throw new Error("Not signed in.");

  const trimmedName = name.trim();
  if (!trimmedName) throw new Error("Enter a name for this discount.");
  if (kind !== "percentage" && kind !== "amount") throw new Error("Invalid discount type.");
  if (!(value > 0)) throw new Error("Enter a value greater than 0.");
  if (kind === "percentage" && value > 100) throw new Error("A percentage discount can't be more than 100.");

  const organizationId = await getCurrentOrganizationId();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("discounts")
    .insert({ organization_id: organizationId, name: trimmedName, kind, value })
    .select()
    .single();
  if (error) throw error;

  revalidatePath("/jobs", "layout");
  revalidatePath("/proposals");
  return data as unknown as Discount;
}
