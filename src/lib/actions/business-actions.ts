"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/team";

/**
 * What the business puts at the top of a document.
 *
 * Stored once on the organisation and read by every receipt after it. A
 * phone number typed into each document is a phone number that is wrong on
 * half of them within a year.
 */
export type BusinessResult = { ok: true } | { ok: false; message: string };

export async function setBusinessDetails(input: {
  phone: string;
  email: string;
  address: string;
  website: string;
  logoPath: string;
}): Promise<BusinessResult> {
  const profile = await getCurrentProfile();
  if (!profile) return { ok: false, message: "Sign in first." };
  if (!profile.roles.includes("admin") && !profile.roles.includes("owner")) {
    return { ok: false, message: "Only an owner or admin can change how the business prints." };
  }

  const email = input.email.trim();
  if (email && !email.includes("@")) return { ok: false, message: "That email does not look right." };

  const website = input.website.trim();
  if (website && !/^[\w.-]+\.[a-z]{2,}(\/.*)?$/i.test(website.replace(/^https?:\/\//i, ""))) {
    return { ok: false, message: "That website does not look right. Something like jslandscapingmd.com." };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("organizations")
    .update({
      business_phone: input.phone.trim().slice(0, 40) || null,
      business_email: email.slice(0, 200) || null,
      // Line breaks kept: an address prints as lines, not as a sentence.
      business_address: input.address.trim().slice(0, 300) || null,
      business_website: website.replace(/^https?:\/\//i, "").slice(0, 200) || null,
      logo_path: input.logoPath.trim().slice(0, 300) || null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", profile.organization_id);
  if (error) return { ok: false, message: error.message };

  revalidatePath("/admin/settings");
  return { ok: true };
}
