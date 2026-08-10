"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentProfile } from "@/lib/data/team";
import { isSupabaseAdminConfigured } from "@/lib/env";
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

export async function createTeamMember(formData: FormData) {
  const caller = await getCurrentProfile();
  if (caller?.role !== "admin") {
    throw new Error("Only admins can add team members.");
  }
  if (!isSupabaseAdminConfigured) {
    throw new Error(
      "The server isn't set up to create accounts yet — add SUPABASE_SERVICE_ROLE_KEY to .env.local and restart."
    );
  }

  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const role: Role = formData.get("role") === "admin" ? "admin" : "crew";

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
  });
  if (error) {
    throw new Error(error.message || "Couldn't create that account.");
  }

  if (role === "admin" && data.user) {
    const supabase = await createClient();
    const { error: roleError } = await supabase.from("profiles").update({ role: "admin" }).eq("id", data.user.id);
    if (roleError) throw roleError;
  }

  revalidatePath("/admin/team");
}
