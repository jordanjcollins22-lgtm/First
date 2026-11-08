/**
 * The funnel field GoHighLevel keeps on every contact: which funnel or source
 * brought them to book. Used to split leads that only say "GoHighLevel
 * calendar" or "Booked online, no trail" into where they really came from.
 * Pure, so it is tested.
 */

export interface GhlFieldDef {
  id: string;
  name: string;
  fieldKey?: string | null;
}

/** Words that mark the funnel field, best first. */
const FUNNEL_WORDS = [/funnel/i, /lead ?source/i, /how did you (hear|find)/i, /\bsource\b/i, /referr/i, /campaign/i];

/** The custom field that tracks the booking funnel, or null when none looks like it. A name set in GHL_FUNNEL_FIELD wins. */
export function funnelField(fields: GhlFieldDef[], preferred?: string | null): GhlFieldDef | null {
  const want = preferred?.trim().toLowerCase();
  if (want) {
    const hit = fields.find((f) => f.name.toLowerCase() === want || f.id === preferred || (f.fieldKey ?? "").toLowerCase() === want);
    if (hit) return hit;
  }
  for (const word of FUNNEL_WORDS) {
    const hit = fields.find((f) => word.test(f.name) || word.test(f.fieldKey ?? ""));
    if (hit) return hit;
  }
  return null;
}

/** One contact's funnel, from its custom field, else GoHighLevel's own attribution, else its source. Tidied for a table. */
export function funnelOf(contact: Record<string, unknown> | null, fieldId: string | null): string | null {
  if (!contact) return null;
  const tidy = (v: unknown) => {
    const s = Array.isArray(v) ? v.filter(Boolean).join(", ") : typeof v === "string" || typeof v === "number" ? String(v) : "";
    const t = s.replace(/\s+/g, " ").trim();
    return t ? t.slice(0, 80) : null;
  };
  if (fieldId) {
    const custom = (contact.customFields ?? contact.customField) as { id?: string; value?: unknown; field_value?: unknown }[] | undefined;
    const own = Array.isArray(custom) ? custom.find((f) => f?.id === fieldId) : undefined;
    const value = tidy(own?.value ?? own?.field_value);
    if (value) return value;
  }
  for (const key of ["attributionSource", "lastAttributionSource"]) {
    const a = contact[key] as Record<string, unknown> | undefined;
    const value = a && tidy(a.utmSource ?? a.campaign ?? a.medium ?? a.sessionSource);
    if (value) return value;
  }
  return tidy(contact.source);
}
