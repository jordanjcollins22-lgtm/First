import { env } from "@/lib/env";
import { getContactRecord, listContactFields } from "@/lib/ghl/client";
import { funnelField, funnelOf } from "@/lib/ghl/funnel";
import { ghlAffiliateTag } from "@/lib/ghl/affiliate-tag";

/**
 * Each GoHighLevel contact's funnel (lib/ghl/funnel.ts) and affiliate tag
 * (lib/ghl/affiliate-tag.ts), for the lead
 * sources report. Read live from GoHighLevel, at most MAX contacts a time
 * and a few at once, and kept for ten minutes so changing the period on the
 * page doesn't ask again. Nothing when GoHighLevel isn't connected.
 */
const MAX = 250;
const KEEP_MS = 10 * 60_000;
export interface GhlClues {
  funnel: string | null;
  /** Whose tagged link it came through (lib/ghl/affiliate-tag.ts), when one. */
  tag: string | null;
}
const seen = new Map<string, { at: number; clues: GhlClues }>();
let fieldCache: { at: number; id: string | null; affiliateId: string | null } | null = null;

export const canReadGhlFunnels = () => Boolean(env.ghlApiKey && env.ghlLocationId);

/**
 * The GoHighLevel booking page a person's tagged link opens: GHL_BOOKING_URL
 * when set, else the "get project evaluated" booking widget most GoHighLevel
 * bookings come through (19 of the last 26, Nov 2026).
 */
const GHL_BOOKING_DEFAULT = "https://links.jslandscapingmd.com/widget/booking/OitFX5dol8Mv1hNZRCCY";
export const ghlBookingBase = () => process.env.GHL_BOOKING_URL?.trim() || GHL_BOOKING_DEFAULT;

/** Each contact's funnel and affiliate tag, for those that have either. */
export async function ghlContactClues(contactIds: string[]): Promise<Map<string, GhlClues>> {
  const out = new Map<string, GhlClues>();
  if (!canReadGhlFunnels() || contactIds.length === 0) return out;
  const now = Date.now();
  if (!fieldCache || now - fieldCache.at > KEEP_MS) {
    const fields = await listContactFields();
    const affiliate = fields.find((f) => {
      const want = process.env.GHL_AFFILIATE_FIELD?.trim().toLowerCase();
      return want ? f.name.toLowerCase() === want || (f.fieldKey ?? "").toLowerCase() === want : /affiliate source/i.test(f.name);
    });
    fieldCache = { at: now, id: funnelField(fields, process.env.GHL_FUNNEL_FIELD)?.id ?? null, affiliateId: affiliate?.id ?? null };
  }
  const { id: fieldId, affiliateId } = fieldCache;
  const todo = [...new Set(contactIds)].slice(0, MAX);
  let next = 0;
  async function worker() {
    while (next < todo.length) {
      const id = todo[next++];
      const kept = seen.get(id);
      let clues = kept && now - kept.at < KEEP_MS ? kept.clues : null;
      if (!clues) {
        const record = await getContactRecord(id);
        clues = { funnel: funnelOf(record, fieldId), tag: ghlAffiliateTag(record, affiliateId) };
      }
      seen.set(id, { at: now, clues });
      if (clues.funnel || clues.tag) out.set(id, clues);
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

