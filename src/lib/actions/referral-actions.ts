"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/team";
import { bookingSlug, getCurrentOrganization } from "@/lib/data/organizations";
import { outboundBaseUrl } from "@/lib/base-url";
import { makeCode, trackedLink } from "@/lib/outreach-links";
import { affiliationLabel, isAffiliation, referralMessage, senderRoleOf } from "@/lib/referral-message";
import { v2RolesOf } from "@/lib/v2-roles";

/**
 * An affiliate sending their link to someone they know. Each one gets its own
 * tracked link, kept with who it went to and how they know them, so the app
 * can show whether that person opened it and credit anything they book. A
 * screenshot of who they're answering can go with it.
 */
export async function startReferral(input: { name: string; affiliation: string; screenshotPath?: string | null }): Promise<{ ok: true; link: string; message: string } | { ok: false; error: string }> {
  const profile = await getCurrentProfile();
  if (!profile) return { ok: false, error: "Sign in again to send your link." };
  const name = input.name.trim().replace(/\s+/g, " ").slice(0, 80);
  if (!name) return { ok: false, error: "Type who you're sending it to." };
  if (!isAffiliation(input.affiliation)) return { ok: false, error: "Pick how you know them." };
  // Optional: a screenshot of who they're answering, uploaded to this business's folder first.
  const shot = input.screenshotPath?.trim() || null;
  if (shot && !new RegExp(`^${profile.organization_id}/[0-9a-f-]{36}\\.(png|jpg|webp)$`).test(shot)) return { ok: false, error: "That screenshot didn't upload. Try it again." };

  const supabase = await createClient();
  const [organization, baseUrl] = await Promise.all([getCurrentOrganization(), outboundBaseUrl(), bookingSlug().catch(() => null)]);
  let code = makeCode();
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const { error } = await supabase.from("outreach_links").insert({
      organization_id: profile.organization_id,
      profile_id: profile.id,
      code,
      kind: "dm",
      platform: "other",
      via: "referral",
      sent_to: name,
      audience: affiliationLabel(input.affiliation),
      screenshot_path: shot,
    });
    if (!error) {
      const link = trackedLink(baseUrl, code);
      revalidatePath("/");
      return { ok: true, link, message: referralMessage({ name, affiliation: input.affiliation, link, business: organization.name, from: profile.full_name ?? null, role: senderRoleOf(v2RolesOf(profile)) }) };
    }
    if (!/duplicate|unique/i.test(error.message)) return { ok: false, error: "Couldn't make your link just now. Try again." };
    code = makeCode();
  }
  return { ok: false, error: "Couldn't make your link just now. Try again." };
}
