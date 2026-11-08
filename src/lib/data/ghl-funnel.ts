import { env } from "@/lib/env";
import { getContactRecord, listContactFields } from "@/lib/ghl/client";
import type { DataScope } from "@/lib/data/review-scope";
import { funnelField, funnelOf } from "@/lib/ghl/funnel";

/**
 * Each GoHighLevel contact's funnel (lib/ghl/funnel.ts), for the lead
 * sources report. Read live from GoHighLevel, at most MAX contacts a time
 * and a few at once, and kept for ten minutes so changing the period on the
 * page doesn't ask again. Nothing when GoHighLevel isn't connected.
 */
const MAX = 250;
const KEEP_MS = 10 * 60_000;
const seen = new Map<string, { at: number; funnel: string | null }>();
let fieldCache: { at: number; id: string | null } | null = null;

export const canReadGhlFunnels = () => Boolean(env.ghlApiKey && env.ghlLocationId);

export async function ghlFunnels(contactIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!canReadGhlFunnels() || contactIds.length === 0) return out;
  const now = Date.now();
  if (!fieldCache || now - fieldCache.at > KEEP_MS) {
    fieldCache = { at: now, id: funnelField(await listContactFields(), process.env.GHL_FUNNEL_FIELD)?.id ?? null };
  }
  const fieldId = fieldCache.id;
  const todo = [...new Set(contactIds)].slice(0, MAX);
  let next = 0;
  async function worker() {
    while (next < todo.length) {
      const id = todo[next++];
      const kept = seen.get(id);
      const funnel = kept && now - kept.at < KEEP_MS ? kept.funnel : funnelOf(await getContactRecord(id), fieldId);
      seen.set(id, { at: now, funnel });
      if (funnel) out.set(id, funnel);
    }
  }
  await Promise.all(Array.from({ length: 6 }, worker));
  return out;
}

/** Preview check: the contact fields GoHighLevel has, and which one is read as the funnel. Names only, no contact data. */
export async function ghlFunnelFields(): Promise<{ connected: boolean; fields: string[]; funnel: string | null }> {
  if (!canReadGhlFunnels()) return { connected: false, fields: [], funnel: null };
  const fields = await listContactFields();
  return { connected: true, fields: fields.map((f) => f.name), funnel: funnelField(fields, process.env.GHL_FUNNEL_FIELD)?.name ?? null };
}

/**
 * Preview check: for the contacts behind sold jobs, how each custom field is
 * filled in. Only fields with a short list of answers (a picked option, not
 * free text) show their answers, so no names, phones or notes come out.
 */
export async function scanGhlFields(scope: DataScope, limit = 80) {
  if (!canReadGhlFunnels()) return { connected: false, contacts: 0, fields: [] as unknown[] };
  const { data } = await scope.client
    .from("jobs")
    .select("id, properties!inner(customers!inner(organization_id, ghl_contact_id)), job_proposals!inner(status, paid_at)")
    .eq("properties.customers.organization_id", scope.organizationId)
    .not("properties.customers.ghl_contact_id", "is", null)
    .order("created_at", { ascending: false })
    .limit(400);
  type Row = { properties: { customers: { ghl_contact_id: string | null } | null } | null; job_proposals: { status: string; paid_at: string | null }[] | { status: string; paid_at: string | null } | null };
  const sold = ((data ?? []) as unknown as Row[]).filter((j) => {
    const ps = Array.isArray(j.job_proposals) ? j.job_proposals : j.job_proposals ? [j.job_proposals] : [];
    return ps.some((p) => p.status === "accepted" || p.paid_at);
  });
  const ids = [...new Set(sold.map((j) => j.properties?.customers?.ghl_contact_id).filter((c): c is string => Boolean(c)))].slice(0, limit);
  const fields = await listContactFields();
  const nameOf = new Map(fields.map((f) => [f.id, f.name]));
  const tally = new Map<string, Map<string, number>>();
  const extra = new Map<string, Map<string, number>>();
  let next = 0;
  async function worker() {
    while (next < ids.length) {
      const c = await getContactRecord(ids[next++]);
      if (!c) continue;
      for (const f of (c.customFields ?? []) as { id?: string; value?: unknown }[]) {
        if (!f?.id) continue;
        const v = (Array.isArray(f.value) ? f.value.join(", ") : String(f.value ?? "")).trim().slice(0, 60);
        if (!v) continue;
        const m = tally.get(f.id) ?? new Map<string, number>();
        m.set(v, (m.get(v) ?? 0) + 1);
        tally.set(f.id, m);
      }
      for (const key of ["source", "type"]) {
        const v = typeof c[key] === "string" ? (c[key] as string).trim().slice(0, 60) : "";
        if (!v) continue;
        const m = extra.get(key) ?? new Map<string, number>();
        m.set(v, (m.get(v) ?? 0) + 1);
        extra.set(key, m);
      }
      const tags = Array.isArray(c.tags) ? (c.tags as string[]) : [];
      const m = extra.get("tags") ?? new Map<string, number>();
      for (const t of tags) m.set(String(t).slice(0, 60), (m.get(String(t).slice(0, 60)) ?? 0) + 1);
      extra.set("tags", m);
    }
  }
  await Promise.all(Array.from({ length: 6 }, worker));
  const shape = (name: string, m: Map<string, number>) => {
    const filled = [...m.values()].reduce((a, b) => a + b, 0);
    const answers = [...m.entries()].sort((a, b) => b[1] - a[1]);
    const picked = answers.length <= 25;
    return { name, filled, distinct: answers.length, answers: picked ? answers.slice(0, 25) : null };
  };
  return {
    connected: true,
    contacts: ids.length,
    fields: [...tally.entries()].map(([id, m]) => shape(nameOf.get(id) ?? id, m)).sort((a, b) => b.filled - a.filled),
    contactInfo: [...extra.entries()].map(([k, m]) => shape(k, m)),
  };
}
