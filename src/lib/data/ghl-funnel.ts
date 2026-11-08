import { env } from "@/lib/env";
import { getContactRecord, listContactFields } from "@/lib/ghl/client";
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
