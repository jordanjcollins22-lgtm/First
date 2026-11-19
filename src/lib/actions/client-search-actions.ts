"use server";

import { getCurrentProfile } from "@/lib/data/team";
import { createClient } from "@/lib/supabase/server";

export interface ClientHit {
  id: string;
  name: string;
  href: string;
  sub?: string;
}

/** Characters that would change the meaning of a PostgREST filter, taken out of what was typed. */
const clean = (q: string) => q.replace(/[%_,()*\\]/g, " ").replace(/\s+/g, " ").trim();

/**
 * Search every client in the company by name, phone, email or address,
 * whoever their account manager is. Staff only, through the signed-in
 * user's own client, so the database's own rules still apply.
 */
export async function searchClients(query: string): Promise<ClientHit[]> {
  const profile = await getCurrentProfile();
  if (!profile) return [];
  const q = clean(query).slice(0, 60);
  if (q.length < 2) return [];
  const digits = q.replace(/\D/g, "");
  const like = `%${q}%`;

  const sb = await createClient();
  const byClient = [`name.ilike.${like}`, `email.ilike.${like}`];
  if (digits.length >= 3) byClient.push(`phone.ilike.%${digits}%`);
  const [people, places] = await Promise.all([
    sb.from("customers").select("id,name,phone").eq("organization_id", profile.organization_id).or(byClient.join(",")).order("name").limit(12),
    sb
      .from("properties")
      .select("address,customer:customers!inner(id,name,organization_id)")
      .eq("customer.organization_id", profile.organization_id)
      .ilike("address", like)
      .limit(12),
  ]);

  const hits = new Map<string, ClientHit>();
  for (const c of people.data ?? []) {
    hits.set(c.id, { id: c.id, name: c.name || "Unnamed client", href: `/clients/${c.id}`, sub: c.phone ?? undefined });
  }
  type Place = { address: string | null; customer: { id: string; name: string | null } | null };
  for (const p of (places.data ?? []) as unknown as Place[]) {
    const c = p.customer;
    if (!c || hits.has(c.id)) continue;
    hits.set(c.id, { id: c.id, name: c.name || "Unnamed client", href: `/clients/${c.id}`, sub: p.address?.split(",")[0] ?? undefined });
  }
  return [...hits.values()].slice(0, 12);
}
