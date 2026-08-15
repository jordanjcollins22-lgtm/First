"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentProfile } from "@/lib/data/team";
import { toE164 } from "@/lib/sms";
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

export type CreateTeamMemberResult = { ok: true } | { ok: false; message: string };

/**
 * Returns a result rather than throwing — an Error thrown out of a Server
 * Action has its message stripped in production, which would turn "enter a
 * first and last name" into an unreadable page error.
 */
export async function createTeamMember(formData: FormData): Promise<CreateTeamMemberResult> {
  try {
    return await createTeamMemberInner(formData);
  } catch (err) {
    console.error("createTeamMember failed:", err);
    const message = err instanceof Error ? err.message : String(err ?? "");
    return { ok: false, message: message || "Couldn't create that account." };
  }
}

async function createTeamMemberInner(formData: FormData): Promise<CreateTeamMemberResult> {
  const caller = await getCurrentProfile();
  if (!caller?.roles.includes("admin")) {
    return { ok: false, message: "Only admins can add team members." };
  }
  if (!isSupabaseAdminConfigured) {
    return {
      ok: false,
      message:
        "The server isn't set up to create accounts yet — add SUPABASE_SERVICE_ROLE_KEY to .env.local and restart.",
    };
  }

  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const role = String(formData.get("role") ?? "").trim() || "crew";
  const payTypeRaw = String(formData.get("pay_type") ?? "hourly").trim();
  const payType = payTypeRaw === "commission" || payTypeRaw === "both" ? payTypeRaw : "hourly";
  const payRateRaw = String(formData.get("pay_rate_per_hour") ?? "").trim();
  const commissionRaw = String(formData.get("commission_pct") ?? "").trim();

  const firstName = String(formData.get("first_name") ?? "").trim();
  const lastName = String(formData.get("last_name") ?? "").trim();
  const phone = String(formData.get("phone") ?? "").trim();
  const drivesForCompany = formData.get("drives_for_company") === "on";
  const licenseNumber = String(formData.get("license_number") ?? "").trim();
  const licenseState = String(formData.get("license_state") ?? "").trim();
  const licenseClass = String(formData.get("license_class") ?? "").trim();
  const licenseExpires = String(formData.get("license_expires") ?? "").trim();

  if (!email || !password) {
    return { ok: false, message: "Enter an email and password." };
  }
  if (!firstName || !lastName) {
    return { ok: false, message: "Enter a first and last name." };
  }
  if (phone && !toE164(phone)) {
    return { ok: false, message: "That doesn't look like a valid phone number." };
  }
  if (password.length < 6) {
    return { ok: false, message: "Password must be at least 6 characters." };
  }

  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { organization_id: caller.organization_id },
  });
  if (error) {
    return { ok: false, message: error.message || "Couldn't create that account." };
  }

  if (data.user) {
    const supabase = await createClient();

    // New accounts default to "crew" (see the profiles trigger) — only need to
    // update it when something else was picked.
    if (role !== "crew") {
      const { error: roleError } = await supabase
        .from("profile_roles")
        .insert({ profile_id: data.user.id, role_name: role });
      if (roleError) return { ok: false, message: roleError.message };
    }

    const { error: payError } = await supabase
      .from("profiles")
      .update({
        first_name: firstName,
        last_name: lastName,
        full_name: `${firstName} ${lastName}`,
        phone: phone || null,
        pay_type: payType,
        pay_rate_per_hour: payType !== "commission" && payRateRaw ? Number(payRateRaw) : null,
        commission_pct: payType !== "hourly" && commissionRaw ? Number(commissionRaw) : null,
        // Licence details are only kept for people who actually drive.
        drives_for_company: drivesForCompany,
        license_number: drivesForCompany ? licenseNumber || null : null,
        license_state: drivesForCompany ? licenseState || null : null,
        license_class: drivesForCompany ? licenseClass || null : null,
        license_expires: drivesForCompany && licenseExpires ? licenseExpires : null,
      })
      .eq("id", data.user.id);
    if (payError) return { ok: false, message: payError.message };
  }

  revalidatePath("/admin/team");
  return { ok: true };
}

/**
 * Hourly pay feeds the blended crew cost per hour used by the service COGS
 * calculator; commission pay (a % of the sale) doesn't — it's not a per-hour
 * labor cost.
 */
export async function updateProfilePay(
  profileId: string,
  payType: "hourly" | "commission" | "both",
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

/** The number click-to-call rings first before bridging to the client, and
 * where inbound calls for their jobs get routed. */
export async function updateProfilePhone(profileId: string, phone: string) {
  const caller = await getCurrentProfile();
  if (!caller?.roles.includes("admin")) {
    throw new Error("Only admins can set phone numbers.");
  }

  const supabase = await createClient();
  const { error } = await supabase.from("profiles").update({ phone: phone.trim() || null }).eq("id", profileId);
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

/**
 * Renames an existing role. Every table pointing at roles(name) is declared
 * `on update cascade`, so assignments and tab permissions follow the rename
 * automatically. System roles (admin/crew) keep their names — code checks
 * for "admin" by name in a few places, so renaming one would lock people out.
 */
export async function renameRole(currentName: string, nextName: string) {
  const caller = await getCurrentProfile();
  if (!caller?.roles.includes("admin")) {
    throw new Error("Only admins can rename roles.");
  }

  const trimmed = nextName.trim().toLowerCase();
  if (!trimmed) throw new Error("Enter a role name.");
  if (!/^[a-z][a-z0-9 _-]*$/.test(trimmed)) {
    throw new Error("Start with a letter — letters, numbers, spaces, - and _ only.");
  }
  if (trimmed === currentName) return;

  const supabase = await createClient();
  const { data: existing, error: lookupError } = await supabase
    .from("roles")
    .select("is_system")
    .eq("name", currentName)
    .maybeSingle();
  if (lookupError) throw lookupError;
  if (!existing) throw new Error("That role no longer exists.");
  if (existing.is_system) throw new Error("Built-in roles can't be renamed.");

  const { error } = await supabase.from("roles").update({ name: trimmed }).eq("name", currentName);
  if (error) {
    if (error.code === "23505") throw new Error("That role already exists.");
    throw error;
  }
  revalidatePath("/admin/team");
  revalidatePath("/admin/permissions");
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

export interface TeamMemberDetailsInput {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  drivesForCompany: boolean;
  licenseNumber: string;
  licenseState: string;
  licenseClass: string;
  licenseExpires: string;
}

export type UpdateTeamMemberResult = { ok: true } | { ok: false; message: string };

/**
 * Admin edit of a team member's details. Goes through the service-role
 * client because RLS won't let one profile update another's row, gated on an
 * app-level admin check plus a same-organization check so an admin can't
 * reach into another business's people.
 *
 * Changing the email also changes their sign-in, so it updates the auth user
 * as well — leaving the two out of step would lock them out.
 */
export async function updateTeamMemberDetails(
  profileId: string,
  input: TeamMemberDetailsInput
): Promise<UpdateTeamMemberResult> {
  try {
    const caller = await getCurrentProfile();
    if (!caller?.roles.includes("admin")) {
      return { ok: false, message: "Only admins can edit team members." };
    }

    const firstName = input.firstName.trim();
    const lastName = input.lastName.trim();
    const email = input.email.trim();
    const phone = input.phone.trim();

    if (!firstName || !lastName) return { ok: false, message: "Enter a first and last name." };
    if (!email) return { ok: false, message: "Enter an email." };
    if (phone && !toE164(phone)) return { ok: false, message: "That doesn't look like a valid phone number." };

    const admin = createAdminClient();
    const { data: existing } = await admin
      .from("profiles")
      .select("email, organization_id")
      .eq("id", profileId)
      .maybeSingle();
    if (!existing) return { ok: false, message: "That team member no longer exists." };
    if (existing.organization_id !== caller.organization_id) {
      return { ok: false, message: "That team member isn't in your organization." };
    }

    if (email.toLowerCase() !== existing.email.toLowerCase()) {
      if (!isSupabaseAdminConfigured) {
        return { ok: false, message: "Changing an email needs SUPABASE_SERVICE_ROLE_KEY set on the server." };
      }
      const { error: authError } = await admin.auth.admin.updateUserById(profileId, { email });
      if (authError) {
        return { ok: false, message: authError.message || "Couldn't change that email." };
      }
    }

    const { error } = await admin
      .from("profiles")
      .update({
        first_name: firstName,
        last_name: lastName,
        full_name: `${firstName} ${lastName}`,
        email,
        phone: phone || null,
        drives_for_company: input.drivesForCompany,
        license_number: input.drivesForCompany ? input.licenseNumber.trim() || null : null,
        license_state: input.drivesForCompany ? input.licenseState.trim() || null : null,
        license_class: input.drivesForCompany ? input.licenseClass.trim() || null : null,
        license_expires: input.drivesForCompany && input.licenseExpires ? input.licenseExpires : null,
      })
      .eq("id", profileId);
    if (error) return { ok: false, message: `${error.message}${error.code ? ` (${error.code})` : ""}` };

    revalidatePath("/admin/team");
    return { ok: true };
  } catch (err) {
    console.error("updateTeamMemberDetails failed:", err);
    return { ok: false, message: err instanceof Error ? err.message : "Something went wrong." };
  }
}
