"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/team";
import type { Role } from "@/types/domain";

export async function updateProfileRole(profileId: string, role: Role) {
  const caller = await getCurrentProfile();
  if (caller?.role !== "admin") {
    throw new Error("Only admins can change roles.");
  }

  const supabase = await createClient();
  const { error } = await supabase.from("profiles").update({ role }).eq("id", profileId);
  if (error) throw error;
  revalidatePath("/admin/team");
}
