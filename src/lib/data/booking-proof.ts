import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { serviceFromLink, type BookingProof, type ProofNews, type ProofReview } from "@/lib/booking-proof";

type Db = Awaited<ReturnType<typeof createClient>> | ReturnType<typeof createAdminClient>;

export interface ProofRow {
  id: string;
  kind: "review" | "news";
  author: string | null;
  body: string | null;
  stars: number | null;
  source: string | null;
  writtenOn: string | null;
  outlet: string | null;
  headline: string | null;
  url: string | null;
  position: number;
  shown: boolean;
}

/** Every review and story, shown or hidden, for the owner's editor. */
export async function listProofRows(organizationId: string, client?: Db): Promise<ProofRow[]> {
  const db = client ?? (await createClient());
  const { data, error } = await db
    .from("booking_proof")
    .select("id, kind, author, body, stars, source, written_on, outlet, headline, url, position, shown")
    .eq("organization_id", organizationId)
    .order("position", { ascending: true })
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => ({
    id: r.id,
    kind: r.kind,
    author: r.author,
    body: r.body,
    stars: r.stars,
    source: r.source,
    writtenOn: r.written_on,
    outlet: r.outlet,
    headline: r.headline,
    url: r.url,
    position: r.position,
    shown: r.shown,
  }));
}

/** What the landing card shows: only the rows switched on, and only complete ones. */
export function proofFromRows(rows: ProofRow[]): BookingProof {
  const reviews: ProofReview[] = rows
    .filter((r) => r.kind === "review" && r.shown && r.body?.trim() && r.author?.trim())
    .map((r) => ({ id: r.id, author: r.author!.trim(), body: r.body!.trim(), stars: r.stars, source: r.source, writtenOn: r.writtenOn }));
  const news: ProofNews[] = rows
    .filter((r) => r.kind === "news" && r.shown && r.outlet?.trim() && r.headline?.trim())
    .map((r) => ({ id: r.id, outlet: r.outlet!.trim(), headline: r.headline!.trim(), url: r.url?.trim() || null }));
  return { reviews, news };
}

/**
 * The proof for the public booking page. The service client, because the
 * person booking is not signed in; scoped to the business by hand.
 */
export async function publicProof(organizationId: string): Promise<BookingProof> {
  return proofFromRows(await listProofRows(organizationId, createAdminClient()));
}

/** The work the person asked about, from the tracked link they came through. */
export async function serviceForCode(code: string | null | undefined): Promise<string | null> {
  if (!code) return null;
  const { data } = await createAdminClient().from("outreach_links").select("service, note").eq("code", code).maybeSingle();
  return data ? serviceFromLink(data.service, data.note) : null;
}
