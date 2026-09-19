import { cache } from "react";

import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/team";
import type { Organization } from "@/types/domain";

/** Every server action that inserts org-scoped data needs this. */
export const getCurrentOrganizationId = cache(async function getCurrentOrganizationId(): Promise<string> {
  const profile = await getCurrentProfile();
  if (!profile) throw new Error("Not signed in.");
  return profile.organization_id;
});

/** Superadmin-only (jordan@jslandscapingmd.com) — RLS restricts everyone else to their own org's row. */
export async function listOrganizations(): Promise<Organization[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("organizations").select("*").order("name");
  if (error) throw error;
  return (data ?? []) as unknown as Organization[];
}

/** Cached per request: the layout, the catalog and half the pricing all want it. */
export const getCurrentOrganization = cache(async function getCurrentOrganization(): Promise<Organization> {
  const organizationId = await getCurrentOrganizationId();
  const supabase = await createClient();
  const { data, error } = await supabase.from("organizations").select("*").eq("id", organizationId).single();
  if (error) throw error;
  return data as unknown as Organization;
});

/**
 * The business's public booking slug, minted if it does not exist yet.
 *
 * Not gated on being an admin, unlike the settings screen's version. This is
 * the identity every public link needs, and an affiliate posting a
 * recommendation cannot be told to go and ask somebody with more permissions
 * to press a button first -- what they would post instead is a dead link.
 *
 * Minting is a no-op when the row already has one, and races are settled by
 * the unique index rather than by checking first: whichever write lands is the
 * slug, and the other reads it back.
 */
export async function bookingSlug(): Promise<string | null> {
  const organization = await getCurrentOrganization();
  if (organization.slug) return organization.slug;

  const base = organization.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
  const slug = `${base || "org"}-${organization.id.slice(0, 8)}`;

  const { createAdminClient } = await import("@/lib/supabase/admin");
  const admin = createAdminClient();
  const { error } = await admin
    .from("organizations")
    .update({ slug })
    .eq("id", organization.id)
    .is("slug", null);
  if (error && error.code !== "23505") {
    console.error("couldn't mint a booking slug:", error);
  }

  const { data } = await admin
    .from("organizations")
    .select("slug")
    .eq("id", organization.id)
    .maybeSingle();
  return data?.slug ?? null;
}
