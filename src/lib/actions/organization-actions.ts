"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentProfile } from "@/lib/data/team";
import { isSupabaseAdminConfigured } from "@/lib/env";

const SUPERADMIN_EMAIL = "jordan@jslandscapingmd.com";

async function requireSuperadmin() {
  const caller = await getCurrentProfile();
  if (!caller || caller.email.toLowerCase() !== SUPERADMIN_EMAIL) {
    throw new Error("Only jordan@jslandscapingmd.com can manage organizations.");
  }
}

/**
 * Creates a brand-new, fully isolated business — its own organization row
 * plus its first admin login. Everything that account creates from here on
 * (customers, jobs, tools, pricing, everything) is scoped to this
 * organization via row-level security; nothing carries over from any other
 * business.
 */
export async function createOrganization(input: { name: string; adminEmail: string; adminPassword: string }) {
  await requireSuperadmin();

  if (!isSupabaseAdminConfigured) {
    throw new Error(
      "The server isn't set up to create accounts yet — add SUPABASE_SERVICE_ROLE_KEY to .env.local and restart."
    );
  }

  const name = input.name.trim();
  const email = input.adminEmail.trim();
  if (!name) throw new Error("Name the business.");
  if (!email || !input.adminPassword) throw new Error("Enter an email and password for its first admin.");
  if (input.adminPassword.length < 6) throw new Error("Password must be at least 6 characters.");

  const supabase = await createClient();
  const { data: organization, error: orgError } = await supabase
    .from("organizations")
    .insert({ name })
    .select()
    .single();
  if (orgError) throw orgError;

  const admin = createAdminClient();
  const { data: userData, error: userError } = await admin.auth.admin.createUser({
    email,
    password: input.adminPassword,
    email_confirm: true,
    user_metadata: { organization_id: organization.id },
  });
  if (userError) {
    throw new Error(userError.message || "Couldn't create that account.");
  }

  if (userData.user) {
    const { error: roleError } = await supabase
      .from("profile_roles")
      .insert({ profile_id: userData.user.id, role_name: "admin" });
    if (roleError) throw roleError;
  }

  revalidatePath("/admin/organizations");
}
