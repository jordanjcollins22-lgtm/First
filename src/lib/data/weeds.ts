import { createClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";
import { getCurrentOrganizationId } from "@/lib/data/organizations";
import { WEED_GROUPS, WEED_SEED, type Weed, type WeedGroup, type WeedPhoto } from "@/lib/weeds";

interface WeedRow {
  id: string;
  slug: string;
  common_name: string;
  scientific_name: string;
  weed_group: string;
  on_client_sheet: boolean;
  code: string;
  print_photo_id: string | null;
  prep: string | null;
  position: number;
}

interface PhotoRow {
  id: string;
  weed_id: string;
  path: string;
  caption: string | null;
  credit: string | null;
  position: number;
  created_at: string;
}

/** A group the database holds that the app no longer prints reads as the first one. */
function groupOf(value: string): WeedGroup {
  return (WEED_GROUPS as readonly string[]).includes(value) ? (value as WeedGroup) : WEED_GROUPS[0];
}

/**
 * Every weed a business has, with its photos.
 *
 * The list ships with the app, so the first time anybody opens the guide it
 * is put in rather than asked for -- sixty-three plants is not something to
 * make somebody type. Adding a weed to the seed later puts that one in too,
 * on the next look, and never touches a row somebody has edited.
 */
export async function listWeeds(): Promise<Weed[]> {
  const supabase = await createClient();
  const org = await getCurrentOrganizationId();

  const read = async () =>
    supabase
      .from("weeds")
      .select("id, slug, common_name, scientific_name, weed_group, on_client_sheet, code, print_photo_id, prep, position")
      .eq("organization_id", org)
      .order("position");

  let { data, error } = await read();
  if (error) throw error;
  if ((data ?? []).length < WEED_SEED.length) {
    const rows = WEED_SEED.map((weed, index) => ({
      slug: weed.slug,
      common: weed.common,
      scientific: weed.scientific,
      grp: weed.group,
      client: weed.client,
      pos: index,
    }));
    const { error: installError } = await supabase.rpc("weeds_install", { org, rows });
    if (installError) throw installError;
    ({ data, error } = await read());
    if (error) throw error;
  }

  const weeds = (data ?? []) as unknown as WeedRow[];
  const { data: photoData, error: photoError } = await supabase
    .from("weed_photos")
    .select("id, weed_id, path, caption, credit, position, created_at")
    .eq("organization_id", org)
    .order("position")
    .order("created_at");
  if (photoError) throw photoError;

  const byWeed = new Map<string, WeedPhoto[]>();
  for (const photo of (photoData ?? []) as unknown as PhotoRow[]) {
    const list = byWeed.get(photo.weed_id) ?? [];
    list.push({ id: photo.id, path: photo.path, caption: photo.caption, credit: photo.credit, position: photo.position });
    byWeed.set(photo.weed_id, list);
  }

  return weeds.map((row) => ({
    id: row.id,
    slug: row.slug,
    common: row.common_name,
    scientific: row.scientific_name,
    group: groupOf(row.weed_group),
    client: row.on_client_sheet,
    code: row.code,
    printPhotoId: row.print_photo_id,
    prep: row.prep,
    photos: byWeed.get(row.id) ?? [],
  }));
}

export interface ScannedWeed {
  id: string;
  slug: string;
  common: string;
  scientific: string;
  group: string;
  code: string;
  prep: string | null;
  printPhotoId: string | null;
  photos: WeedPhoto[];
}

/**
 * The weed behind a scanned code.
 *
 * Read with no login, because whoever scanned it is standing in front of the
 * sheet holding the plant. The answer is one plant and its pictures; there is
 * nothing on it belonging to the business or to a client.
 */
export async function weedByCode(code: string): Promise<ScannedWeed | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("weed_by_code", { the_code: code });
  if (error) throw error;
  const weed = data as unknown as ScannedWeed | null;
  return weed && weed.id ? weed : null;
}

/** Where a weed photo is served from. Public: a client scans the sheet with no login. */
export async function weedPhotoUrl(path: string): Promise<string> {
  const supabase = await createClient();
  return supabase.storage.from("weed-photos").getPublicUrl(path).data.publicUrl;
}

/**
 * The same photo, cropped to the box the sheet gives it and always a JPEG.
 *
 * A PDF can carry a JPEG or a PNG and nothing else, and the photos people
 * have uploaded are a mixture of JPEG, PNG, WebP and one GIF. Storage's own
 * transformer settles both at once: it crops to the aspect the sheet wants
 * so the picture is not squashed, and it answers in whatever format the
 * request will accept -- which, for us, is JPEG only.
 *
 * Asked for at print resolution rather than screen: a photo about an inch and
 * a half across wants five hundred pixels to look like a photograph on paper
 * instead of a thumbnail somebody enlarged.
 */
export function weedPhotoJpegUrl(path: string, width: number, height: number): string {
  const base = env.supabaseUrl.replace(/\/$/, "");
  const encoded = path.split("/").map(encodeURIComponent).join("/");
  const query = new URLSearchParams({
    width: String(Math.round(width)),
    height: String(Math.round(height)),
    resize: "cover",
    quality: "80",
  });
  return `${base}/storage/v1/render/image/public/weed-photos/${encoded}?${query.toString()}`;
}
