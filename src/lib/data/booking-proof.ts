import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { serviceFromLink, showcaseTitleFromCaption, type BookingProof, type ProofNews, type ProofReview, type ShowcaseItem } from "@/lib/booking-proof";

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

/**
 * What the landing card shows: only the rows switched on, only complete
 * ones, and only five-star reviews. One entered by hand with fewer stars
 * stays in the editor and never reaches the page.
 */
export function proofFromRows(rows: ProofRow[]): BookingProof {
  const reviews: ProofReview[] = rows
    .filter((r) => r.kind === "review" && r.shown && r.body?.trim() && r.author?.trim() && (r.stars == null || r.stars === 5))
    .map((r) => ({ id: r.id, author: r.author!.trim(), body: r.body!.trim(), stars: r.stars, source: r.source, writtenOn: r.writtenOn }));
  const news: ProofNews[] = rows
    .filter((r) => r.kind === "news" && r.shown && r.outlet?.trim() && r.headline?.trim())
    .map((r) => ({ id: r.id, outlet: r.outlet!.trim(), headline: r.headline!.trim(), url: r.url?.trim() || null }));
  return { reviews, news, showcase: [] };
}

/** A before-and-after as the owner's editor lists it. */
export interface ShowcaseRow extends ShowcaseItem {
  shown: boolean;
}

/**
 * Every before-and-after the landing card can show: the posts approved and
 * formatted in Before & After Posts, from the crew's own job photos. An
 * unapproved post is never here, and neither is anything from outside the
 * app.
 */
export async function listShowcase(organizationId: string, client?: Db): Promise<ShowcaseRow[]> {
  const db = client ?? (await createClient());
  const { data: posts, error } = await db
    .from("social_posts")
    .select("id, image_path, caption, zone_name, on_booking_page, approved_at")
    .eq("organization_id", organizationId)
    .in("status", ["approved", "scheduled", "posted"])
    .not("image_path", "is", null)
    .order("approved_at", { ascending: false })
    .limit(30);
  if (error) throw new Error(error.message);
  const base = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/$/, "");
  return (posts ?? []).map((p) => ({
    id: p.id,
    title: showcaseTitleFromCaption(p.caption, p.zone_name),
    // The social bucket is public on purpose: only approved work lands there.
    imageUrl: `${base}/storage/v1/object/public/social-posts/${p.image_path}`,
    shown: p.on_booking_page,
  }));
}

export function shownShowcase(rows: ShowcaseRow[]): ShowcaseItem[] {
  return rows
    .filter((r) => r.shown)
    .map(({ id, title, imageUrl }) => ({ id, title, imageUrl }));
}

/**
 * The proof for the public booking page. The service client, because the
 * person booking is not signed in; scoped to the business by hand.
 */
export async function publicProof(organizationId: string): Promise<BookingProof> {
  const admin = createAdminClient();
  const [rows, showcase] = await Promise.all([
    listProofRows(organizationId, admin),
    // The pictures never take the page down: a card with no before-and-afters
    // still books.
    listShowcase(organizationId, admin).catch(() => []),
  ]);
  return { ...proofFromRows(rows), showcase: shownShowcase(showcase) };
}

/** The work the person asked about, from the tracked link they came through. */
export async function serviceForCode(code: string | null | undefined): Promise<string | null> {
  if (!code) return null;
  const { data } = await createAdminClient().from("outreach_links").select("service, note").eq("code", code).maybeSingle();
  return data ? serviceFromLink(data.service, data.note) : null;
}
