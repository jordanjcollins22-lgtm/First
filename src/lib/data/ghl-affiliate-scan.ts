import { getContactRecord, listContactFields } from "@/lib/ghl/client";
import { canReadGhlFunnels } from "@/lib/data/ghl-funnel";
import type { DataScope } from "@/lib/data/review-scope";

/**
 * TEMPORARY preview check: how GoHighLevel records where a calendar booking's
 * contact came from (attribution page, utm tags, affiliate ids), counted. No
 * names, phones, emails or addresses: pages are host and path only, and only
 * tag-like values (utm, ref, am_id) are counted.
 */
const TAG_KEYS = /^(utm_|am_|ref|aff|fpr|via|rfsn|gclid$|fbclid$)/i;

export async function scanGhlAffiliate(scope: DataScope, limit = 300) {
  if (!canReadGhlFunnels()) return { connected: false };
  const { data } = await scope.client
    .from("jobs")
    .select("id, created_at, ghl_appointment_id, referral_code, referred_by_profile_id, properties!inner(customers!inner(organization_id, ghl_contact_id))")
    .eq("properties.customers.organization_id", scope.organizationId)
    .not("properties.customers.ghl_contact_id", "is", null)
    .order("created_at", { ascending: false })
    .limit(1500);
  type Row = { ghl_appointment_id: string | null; referral_code: string | null; referred_by_profile_id: string | null; properties: { customers: { ghl_contact_id: string | null } | null } | null };
  const rows = (data ?? []) as unknown as Row[];
  const vague = rows.filter((r) => !r.referral_code && !r.referred_by_profile_id);
  const ids = [...new Set(vague.map((r) => r.properties?.customers?.ghl_contact_id).filter((c): c is string => Boolean(c)))].slice(0, limit);
  const fields = await listContactFields();
  const nameOf = new Map(fields.map((f) => [f.id, f.name]));
  const t = new Map<string, Map<string, number>>();
  const bump = (k: string, v: unknown) => {
    const s = String(v ?? "").trim().slice(0, 80);
    if (!s) return;
    const m = t.get(k) ?? new Map<string, number>();
    m.set(s, (m.get(s) ?? 0) + 1);
    t.set(k, m);
  };
  let read = 0;
  let next = 0;
  async function worker() {
    while (next < ids.length) {
      const c = await getContactRecord(ids[next++]);
      if (!c) continue;
      read += 1;
      bump("contact.source", c.source);
      bump("contact.type", c.type);
      for (const tag of Array.isArray(c.tags) ? c.tags : []) bump("tags", tag);
      bump("contact.keys", Object.keys(c).sort().join(","));
      for (const key of ["attributionSource", "lastAttributionSource"]) {
        const a = c[key] as Record<string, unknown> | undefined;
        if (!a) { bump(`${key}`, "(none)"); continue; }
        bump(`${key}.keys`, Object.keys(a).sort().join(","));
        for (const [k, v] of Object.entries(a)) {
          if (typeof v !== "string" || !v) continue;
          if (/url|referrer/i.test(k)) {
            try {
              const u = new URL(v);
              bump(`${key}.${k}.page`, `${u.hostname}${u.pathname}`);
              for (const [pk, pv] of u.searchParams) {
                bump(`${key}.${k}.paramKeys`, pk);
                if (TAG_KEYS.test(pk)) bump(`${key}.${k}.param.${pk}`, pv);
              }
            } catch { bump(`${key}.${k}.page`, "(not a url)"); }
          } else if (/utm|medium|source|campaign|adSource|fbclid|gclid|am_|affiliate|ref/i.test(k)) {
            bump(`${key}.${k}`, /fbclid|gclid|ip|userAgent/i.test(k) ? "(set)" : v);
          }
        }
      }
      for (const f of (c.customFields ?? []) as { id?: string; value?: unknown }[]) {
        const name = nameOf.get(f?.id ?? "") ?? f?.id ?? "?";
        if (/refer|affil|ref\b|partner|who|hear|source|utm|campaign|am_id/i.test(name)) {
          bump(`field:${name}`, Array.isArray(f.value) ? f.value.join(", ") : f.value);
        } else bump("otherFieldsFilled", name);
      }
    }
  }
  await Promise.all(Array.from({ length: 6 }, worker));
  const shape = (m: Map<string, number>) => {
    const answers = [...m.entries()].sort((a, b) => b[1] - a[1]);
    return { distinct: answers.length, filled: answers.reduce((a, b) => a + b[1], 0), top: answers.length <= 40 ? answers : answers.slice(0, 15).map(([k, n]) => [k.length > 30 ? "(long)" : k, n]) };
  };
  return {
    connected: true,
    jobsWithContact: rows.length,
    vagueJobs: vague.length,
    withAppointment: vague.filter((r) => r.ghl_appointment_id).length,
    contactsRead: read,
    fieldNames: fields.map((f) => `${f.name} [${f.fieldKey ?? ""}]`),
    tallies: Object.fromEntries([...t.entries()].map(([k, m]) => [k, shape(m)])),
  };
}
