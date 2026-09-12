"use server";

import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { getRealProfile } from "@/lib/data/team";
import { setViewAsProfileId, clearViewAsProfileId } from "@/lib/impersonation";

/** Admin-only account switch — see getCurrentProfile() in lib/data/team.ts for
 * how this takes effect everywhere else in the app. */
export async function startImpersonation(targetProfileId: string) {
  const real = await getRealProfile();
  if (!real?.roles.includes("admin")) throw new Error("Only admins can switch accounts.");
  if (targetProfileId === real.id) throw new Error("That's your own account.");

  const supabase = await createClient();
  const { data: target, error } = await supabase
    .from("profiles")
    .select("id, organization_id")
    .eq("id", targetProfileId)
    .maybeSingle();
  if (error) throw error;
  if (!target || target.organization_id !== real.organization_id) {
    throw new Error("That account isn't in your organization.");
  }

  await setViewAsProfileId(targetProfileId);
  redirect("/");
}

export async function stopImpersonation() {
  await clearViewAsProfileId();
  redirect("/");
}
