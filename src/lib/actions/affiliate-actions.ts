"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentProfile, listProfiles } from "@/lib/data/team";
import { getCurrentOrganization } from "@/lib/data/organizations";
import { qualifiesForAffiliateLink } from "@/lib/affiliate-roles";

function generateSlug(): string {
  return randomUUID().replace(/-/g, "").slice(0, 10);
}

/** Admin-only: generates a link for any evaluator/account manager who doesn't have one yet. */
export async function ensureAffiliateSlugs() {
  const caller = await getCurrentProfile();
  if (!caller?.roles.includes("admin")) throw new Error("Only admins can manage booking links.");

  const profiles = await listProfiles();
  const needsSlug = profiles.filter((p) => qualifiesForAffiliateLink(p.roles) && !p.affiliate_slug);
  if (needsSlug.length === 0) return;

  const supabase = await createClient();
  for (const profile of needsSlug) {
    const { error } = await supabase.from("profiles").update({ affiliate_slug: generateSlug() }).eq("id", profile.id);
    if (error && error.code !== "23505") throw error;
  }
  revalidatePath("/booking-links");
}

/** Self-service: lets a qualifying team member get their own link without needing
 * general profile-update rights (regular RLS only lets admins update profiles). */
export async function ensureMyAffiliateSlug() {
  const caller = await getCurrentProfile();
  if (!caller) throw new Error("Not signed in.");
  if (caller.affiliate_slug) return;
  if (!qualifiesForAffiliateLink(caller.roles)) return;

  const admin = createAdminClient();
  const { error } = await admin
    .from("profiles")
    .update({ affiliate_slug: generateSlug() })
    .eq("id", caller.id)
    .is("affiliate_slug", null);
  if (error && error.code !== "23505") throw error;
  revalidatePath("/booking-links");
}

/** Admin-only: the org's own row can only be updated by the superadmin account via RLS,
 * so this goes through the service-role client, gated by an app-level admin check. */
export async function ensureOrganizationSlug() {
  const caller = await getCurrentProfile();
  if (!caller?.roles.includes("admin")) throw new Error("Only admins can manage booking links.");

  const org = await getCurrentOrganization();
  if (org.slug) return;

  const base = org.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
  const slug = `${base || "org"}-${org.id.slice(0, 8)}`;

  const admin = createAdminClient();
  const { error } = await admin.from("organizations").update({ slug }).eq("id", org.id).is("slug", null);
  if (error && error.code !== "23505") throw error;
  revalidatePath("/booking-links");
}
