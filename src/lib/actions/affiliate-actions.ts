"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentProfile, listProfiles } from "@/lib/data/team";
import { getCurrentOrganization } from "@/lib/data/organizations";
import { isAffiliate } from "@/lib/data/affiliate";

function generateSlug(): string {
  return randomUUID().replace(/-/g, "").slice(0, 10);
}

/** Admin-only: generates a link for any evaluator/account manager who doesn't have one yet. */
export async function ensureAffiliateSlugs() {
  const caller = await getCurrentProfile();
  if (!caller?.roles.includes("admin")) throw new Error("Only admins can manage booking links.");

  const profiles = await listProfiles();
  const needsSlug = profiles.filter((p) => isAffiliate(p) && !p.affiliate_slug);
  if (needsSlug.length === 0) return;

  const supabase = await createClient();
  for (const profile of needsSlug) {
    const { error } = await supabase.from("profiles").update({ affiliate_slug: generateSlug() }).eq("id", profile.id);
    if (error && error.code !== "23505") throw error;
  }
  revalidatePath("/evaluations");
  revalidatePath("/");
}

/** Self-service: lets a qualifying team member get their own link without needing
 * general profile-update rights (regular RLS only lets admins update profiles). */
export async function ensureMyAffiliateSlug() {
  const caller = await getCurrentProfile();
  if (!caller) throw new Error("Not signed in.");
  if (caller.affiliate_slug) return;
  if (!isAffiliate(caller)) return;

  const admin = createAdminClient();
  const { error } = await admin
    .from("profiles")
    .update({ affiliate_slug: generateSlug() })
    .eq("id", caller.id)
    .is("affiliate_slug", null);
  if (error && error.code !== "23505") throw error;
  revalidatePath("/evaluations");
  revalidatePath("/");
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
  revalidatePath("/evaluations");
  revalidatePath("/");
}

export type AffiliateResult = { ok: true } | { ok: false; message: string };

/** Admin-only: makes someone an affiliate and gives them a link in the same
 * step, so "added" and "has a link to hand out" are never out of sync. */
export async function setAffiliate(profileId: string, makeAffiliate: boolean): Promise<AffiliateResult> {
  try {
    const caller = await getCurrentProfile();
    if (!caller?.roles.includes("admin")) {
      return { ok: false, message: "Only admins can manage affiliates." };
    }

    const admin = createAdminClient();
    const { data: existing } = await admin
      .from("profiles")
      .select("affiliate_slug, organization_id")
      .eq("id", profileId)
      .maybeSingle();
    if (!existing) return { ok: false, message: "That team member no longer exists." };
    if (existing.organization_id !== caller.organization_id) {
      return { ok: false, message: "That team member isn't in your organization." };
    }

    const patch: { is_affiliate: boolean; affiliate_slug?: string } = { is_affiliate: makeAffiliate };
    // Keep an existing slug on removal — links already shared stay resolvable
    // rather than 404ing, they just stop being offered.
    if (makeAffiliate && !existing.affiliate_slug) patch.affiliate_slug = generateSlug();

    const { error } = await admin.from("profiles").update(patch).eq("id", profileId);
    if (error) return { ok: false, message: `${error.message}${error.code ? ` (${error.code})` : ""}` };

    revalidatePath("/evaluations");
    revalidatePath("/");
    return { ok: true };
  } catch (err) {
    console.error("setAffiliate failed:", err);
    return { ok: false, message: err instanceof Error ? err.message : "Something went wrong." };
  }
}
