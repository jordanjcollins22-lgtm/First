"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentProfile } from "@/lib/data/team";
import { isSupabaseAdminConfigured } from "@/lib/env";
import type { Role } from "@/types/domain";

export async function addProfileRole(profileId: string, role: Role) {
  const caller = await getCurrentProfile();
  if (!caller?.roles.includes("admin")) {
    throw new Error("Only admins can change roles.");
  }

  const supabase = await createClient();
  const { error } = await supabase.from("profile_roles").insert({ profile_id: profileId, role_name: role });
  if (error && error.code !== "23505") throw error;
  revalidatePath("/admin/team");
}

export async function removeProfileRole(profileId: string, role: Role) {
  const caller = await getCurrentProfile();
  if (!caller?.roles.includes("admin")) {
    throw new Error("Only admins can change roles.");
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("profile_roles")
    .delete()
    .eq("profile_id", profileId)
    .eq("role_name", role);
  if (error) throw error;
  revalidatePath("/admin/team");
}

export async function createTeamMember(formData: FormData) {
  const caller = await getCurrentProfile();
  if (!caller?.roles.includes("admin")) {
    throw new Error("Only admins can add team members.");
  }
  if (!isSupabaseAdminConfigured) {
    throw new Error(
      "The server isn't set up to create accounts yet — add SUPABASE_SERVICE_ROLE_KEY to .env.local and restart."
    );
  }

  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const role = String(formData.get("role") ?? "").trim() || "crew";

  if (!email || !password) {
    throw new Error("Enter an email and password.");
  }
  if (password.length < 6) {
    throw new Error("Password must be at least 6 characters.");
  }

  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { organization_id: caller.organization_id },
  });
  if (error) {
    throw new Error(error.message || "Couldn't create that account.");
  }

  // New accounts default to "crew" (see the profiles trigger) — only need to
  // update it when something else was picked.
  if (role !== "crew" && data.user) {
    const supabase = await createClient();
    const { error: roleError } = await supabase
      .from("profile_roles")
      .insert({ profile_id: data.user.id, role_name: role });
    if (roleError) throw roleError;
  }

  revalidatePath("/admin/team");
}

/**
 * Hourly pay feeds the blended crew cost per hour used by the service COGS
 * calculator; commission pay (a % of the sale) doesn't — it's not a per-hour
 * labor cost.
 */
export async function updateProfilePay(
  profileId: string,
  payType: "hourly" | "commission",
  payRatePerHour: number | null,
  commissionPct: number | null
) {
  const caller = await getCurrentProfile();
  if (!caller?.roles.includes("admin")) {
    throw new Error("Only admins can set pay.");
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("profiles")
    .update({ pay_type: payType, pay_rate_per_hour: payRatePerHour, commission_pct: commissionPct })
    .eq("id", profileId);
  if (error) throw error;
  revalidatePath("/admin/team");
}

export async function setTeamMemberPassword(profileId: string, password: string) {
  const caller = await getCurrentProfile();
  if (!caller?.roles.includes("admin")) {
    throw new Error("Only admins can set passwords.");
  }
  if (!isSupabaseAdminConfigured) {
    throw new Error(
      "The server isn't set up to change passwords yet — add SUPABASE_SERVICE_ROLE_KEY to .env.local and restart."
    );
  }
  if (password.length < 6) {
    throw new Error("Password must be at least 6 characters.");
  }

  const admin = createAdminClient();
  const { error } = await admin.auth.admin.updateUserById(profileId, { password });
  if (error) {
    throw new Error(error.message || "Couldn't update that password.");
  }
}

export async function addRole(name: string) {
  const caller = await getCurrentProfile();
  if (!caller?.roles.includes("admin")) {
    throw new Error("Only admins can add roles.");
  }

  const trimmed = name.trim().toLowerCase();
  if (!trimmed) throw new Error("Enter a role name.");
  if (!/^[a-z][a-z0-9 _-]*$/.test(trimmed)) {
    throw new Error("Start with a letter — letters, numbers, spaces, - and _ only.");
  }

  const supabase = await createClient();
  const { error } = await supabase.from("roles").insert({ name: trimmed });
  if (error) {
    if (error.code === "23505") throw new Error("That role already exists.");
    throw error;
  }
  revalidatePath("/admin/team");
}

export async function deleteRole(name: string) {
  const caller = await getCurrentProfile();
  if (!caller?.roles.includes("admin")) {
    throw new Error("Only admins can remove roles.");
  }

  const supabase = await createClient();
  const { error } = await supabase.from("roles").delete().eq("name", name);
  if (error) {
    if (error.code === "23503") throw new Error("Someone still has this role — change their role first.");
    throw error;
  }
  revalidatePath("/admin/team");
}
