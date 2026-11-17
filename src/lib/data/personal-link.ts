import { randomBytes } from "node:crypto";

import { appUrl } from "@/lib/app-url";
import { dashboardPath, slugBase } from "@/lib/personal-link";
import { createAdminClient } from "@/lib/supabase/admin";

/** Four letters and digits, so a link can't be guessed from somebody's name. */
function tail(): string {
  const abc = "abcdefghjkmnpqrstuvwxyz23456789";
  return [...randomBytes(4)].map((b) => abc[b % abc.length]).join("");
}

/**
 * Their own link to their page, made the first time it's needed (the
 * migration fills one in for everybody already here, and a trigger for
 * everybody added after). Null when it can't be read, such as before the
 * migration is applied.
 */
export async function myDashboardLink(
  profile: { id: string; full_name?: string | null; email?: string | null; dashboard_slug?: string | null },
  baseUrl: string,
): Promise<string | null> {
  let slug = profile.dashboard_slug ?? null;
  if (!slug) {
    const admin = createAdminClient();
    for (let i = 0; i < 3 && !slug; i++) {
      const fresh = `${slugBase(profile)}-${tail()}`;
      const { error } = await admin.from("profiles").update({ dashboard_slug: fresh }).eq("id", profile.id).is("dashboard_slug", null);
      if (error && error.code !== "23505") return null;
      const { data } = await admin.from("profiles").select("dashboard_slug").eq("id", profile.id).maybeSingle();
      slug = (data as { dashboard_slug?: string | null } | null)?.dashboard_slug ?? null;
    }
  }
  return slug ? appUrl(baseUrl, dashboardPath(slug)) : null;
}
