import { createAdminClient } from "@/lib/supabase/admin";
import { env } from "@/lib/env";
import { log } from "@/lib/log";
import { CONTACT_PATHS, bestEmail, extractEmails, hostOf } from "@/lib/pm-outreach";

type Admin = ReturnType<typeof createAdminClient>;

/** How often the towns are searched again for new companies. */
const SEARCH_EVERY_MS = 7 * 86_400_000;

interface Place {
  id: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  websiteUri?: string;
  nationalPhoneNumber?: string;
  location?: { latitude?: number; longitude?: number };
  businessStatus?: string;
}

/**
 * Property management companies in each town, from Google's business
 * listings. Once a week; each new one is kept, and one already known is
 * left as it is, so nothing the office changed is written over. Off until
 * the Google Places key is set.
 */
export async function findCompanies(admin: Admin, organizationId: string, towns: string[], lastSearchAt: string | null, now: Date): Promise<number> {
  if (!env.googlePlacesApiKey) return 0;
  if (lastSearchAt && now.getTime() - new Date(lastSearchAt).getTime() < SEARCH_EVERY_MS) return 0;
  let added = 0;
  for (const town of towns.slice(0, 20)) {
    const places = await searchText(`property management company in ${town}`).catch((err) => {
      log.warn("pm.search_failed", { town, error: err instanceof Error ? err.message : String(err) });
      return [] as Place[];
    });
    for (const place of places) {
      if (!place.id || !place.displayName?.text || place.businessStatus === "CLOSED_PERMANENTLY") continue;
      const { data, error } = await admin
        .from("pm_companies")
        .upsert(
          {
            organization_id: organizationId,
            place_id: place.id,
            name: place.displayName.text.slice(0, 160),
            website: place.websiteUri ?? null,
            phone: place.nationalPhoneNumber ?? null,
            address: place.formattedAddress ?? null,
            lat: place.location?.latitude ?? null,
            lng: place.location?.longitude ?? null,
            source: "google_places",
            status: place.websiteUri ? "new" : "no_email",
          },
          { onConflict: "organization_id,place_id", ignoreDuplicates: true }
        )
        .select("id");
      if (!error && (data ?? []).length > 0) added += 1;
    }
  }
  await admin.from("pm_outreach_settings").update({ last_search_at: now.toISOString() }).eq("organization_id", organizationId);
  log.info("pm.companies_found", { organizationId, added });
  return added;
}

async function searchText(query: string): Promise<Place[]> {
  const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "X-Goog-Api-Key": env.googlePlacesApiKey,
      "X-Goog-FieldMask": "places.id,places.displayName,places.formattedAddress,places.websiteUri,places.nationalPhoneNumber,places.location,places.businessStatus",
    },
    body: JSON.stringify({ textQuery: query, maxResultCount: 20 }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Places answered ${res.status}`);
  const body = (await res.json()) as { places?: Place[] };
  return body.places ?? [];
}

/**
 * The email to write to, read off each new company's own website: its home
 * page and the usual contact and about pages. A few companies a run, so a
 * slow site never holds the timer up.
 */
export async function findEmails(admin: Admin, organizationId: string, limit = 6): Promise<number> {
  const { data: rows } = await admin
    .from("pm_companies")
    .select("id, website")
    .eq("organization_id", organizationId)
    .eq("status", "new")
    .order("created_at")
    .limit(limit);
  let found = 0;
  for (const row of rows ?? []) {
    const host = hostOf(row.website);
    if (!host) {
      await admin.from("pm_companies").update({ status: "no_email", updated_at: new Date().toISOString() }).eq("id", row.id);
      continue;
    }
    const emails = new Set<string>();
    for (const path of CONTACT_PATHS) {
      const html = await readPage(`https://${host}${path}`);
      for (const email of extractEmails(html)) emails.add(email);
      if (bestEmail([...emails], host)) break;
    }
    const email = bestEmail([...emails], host);
    if (email) found += 1;
    await admin
      .from("pm_companies")
      .update({ email, email_source: email ? "website" : null, status: email ? "ready" : "no_email", updated_at: new Date().toISOString() })
      .eq("id", row.id)
      .eq("status", "new");
  }
  return found;
}

async function readPage(url: string): Promise<string> {
  try {
    const res = await fetch(url, {
      headers: { "user-agent": "Mozilla/5.0 (compatible; JSLandscapingMD contact lookup; +https://jslandscapingmd.com)" },
      redirect: "follow",
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok || !/text\/html/i.test(res.headers.get("content-type") ?? "")) return "";
    return (await res.text()).slice(0, 400_000);
  } catch {
    return "";
  }
}
