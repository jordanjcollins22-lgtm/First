import { fetchJson } from "../http";
import { htmlToText } from "../normalize";

/**
 * Notice detail + attachments via the keyless endpoints behind the sam.gov
 * website. Undocumented (could change), so callers treat failures as
 * "no documents" rather than fatal. These are where the scope of work,
 * wage determination and pricing schedule actually live.
 */
const SAM_WEB_API = "https://sam.gov/api/prod/opps";

export interface SamAttachment {
  resourceId: string;
  name: string;
  /** ".pdf", ".docx", ".xlsx", ... */
  extension: string;
  size: number | null;
  downloadUrl: string;
}

interface ResourcesResponse {
  _embedded?: {
    opportunityAttachmentList?: Array<{
      attachments?: Array<{
        resourceId: string;
        name: string;
        mimeType?: string;
        size?: number;
        accessLevel?: string;
        type?: string;
        uri?: string | null;
        deletedFlag?: string;
      }>;
    }>;
  };
}

export async function listAttachments(noticeId: string): Promise<SamAttachment[]> {
  const data = await fetchJson<ResourcesResponse>(
    `${SAM_WEB_API}/v3/opportunities/${noticeId}/resources`,
    { retries: 2, headers: { Accept: "application/hal+json, application/json" } }
  );
  const out: SamAttachment[] = [];
  for (const group of data._embedded?.opportunityAttachmentList ?? []) {
    for (const a of group.attachments ?? []) {
      if (a.accessLevel && a.accessLevel !== "public") continue;
      if (a.type && a.type !== "file") continue; // external links
      if (a.deletedFlag === "1") continue;
      const ext = (a.mimeType ?? a.name.slice(a.name.lastIndexOf("."))).toLowerCase();
      out.push({
        resourceId: a.resourceId,
        name: a.name,
        extension: ext.startsWith(".") ? ext : `.${ext}`,
        size: a.size ?? null,
        downloadUrl: `${SAM_WEB_API}/v3/opportunities/resources/files/${a.resourceId}/download`,
      });
    }
  }
  return out;
}

export async function downloadAttachment(att: SamAttachment, maxBytes = 20_000_000): Promise<Uint8Array | null> {
  if (att.size && att.size > maxBytes) return null;
  const res = await fetch(att.downloadUrl, { redirect: "follow", signal: AbortSignal.timeout(60_000) });
  if (!res.ok) return null;
  const buf = new Uint8Array(await res.arrayBuffer());
  return buf.byteLength > maxBytes ? null : buf;
}

interface DetailResponse {
  data2?: {
    placeOfPerformance?: {
      streetAddress?: string;
      city?: { name?: string };
      state?: { code?: string };
      zip?: string;
      country?: { code?: string };
    };
  };
  description?: Array<{ body?: string }>;
}

/** Full description (all amendments' text) and structured place of performance. */
export async function getNoticeDetail(noticeId: string) {
  const d = await fetchJson<DetailResponse>(`${SAM_WEB_API}/v2/opportunities/${noticeId}`, {
    retries: 2,
    headers: { Accept: "application/hal+json, application/json" },
  });
  const pop = d.data2?.placeOfPerformance;
  return {
    description: htmlToText((d.description ?? []).map((x) => x.body ?? "").join("\n\n")),
    placeOfPerformance: pop
      ? {
          street: pop.streetAddress ?? null,
          city: pop.city?.name ?? null,
          state: pop.state?.code ?? null,
          zip: pop.zip ?? null,
          country: pop.country?.code ?? null,
        }
      : null,
  };
}

/**
 * Rank attachments so the scope of work and solicitation come first and
 * forms (questionnaires, surveys, past-performance templates) last — we
 * only send the model what fits in one request.
 */
export function rankAttachments(atts: SamAttachment[]): SamAttachment[] {
  const score = (a: SamAttachment) => {
    const n = a.name.toLowerCase();
    let s = 0;
    if (/\b(sow|pws|statement of work|performance work statement|scope)\b/.test(n)) s += 10;
    if (/wage determination|\bwd\b|sca/.test(n)) s += 6;
    if (/solicitation|rfq|rfp|ifb|sf ?1449|sf ?18|sf ?1442|combined/.test(n)) s += 5;
    if (/amendment|amd|sf ?30/.test(n)) s += 3;
    if (/price|pricing|schedule|clin|bid sheet/.test(n)) s += 4;
    if (/drawing|map|site plan|frequency|exhibit|attachment/.test(n)) s += 2;
    if (/questionnaire|survey|past performance|form|certification|representations/.test(n)) s -= 3;
    if (![".pdf", ".docx", ".doc", ".txt", ".xlsx"].includes(a.extension)) s -= 20;
    return s;
  };
  return [...atts].sort((a, b) => score(b) - score(a));
}
