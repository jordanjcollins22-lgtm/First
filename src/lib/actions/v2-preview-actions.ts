"use server";

import { redirect } from "next/navigation";

import { getRealProfile } from "@/lib/data/team";
import { createClient } from "@/lib/supabase/server";
import { clearViewAsProfileId, setViewAsProfileId } from "@/lib/impersonation";

/**
 * Preview as, in the new layout: the app's own "view as" switch, landing back
 * on the new layout instead of the old home. Admin only, own organization
 * only, the same checks as startImpersonation. An empty id is yourself.
 */
export async function previewV2As(formData: FormData) {
  const real = await getRealProfile();
  if (!real?.roles.includes("admin")) throw new Error("Only admins can preview as somebody else.");
  const target = String(formData.get("profileId") ?? "");

  if (!target || target === real.id) {
    await clearViewAsProfileId();
  } else {
    const supabase = await createClient();
    const { data } = await supabase.from("profiles").select("id, organization_id").eq("id", target).maybeSingle();
    if (!data || data.organization_id !== real.organization_id) throw new Error("That account isn't in your organization.");
    await setViewAsProfileId(target);
  }
  redirect("/v2");
}
