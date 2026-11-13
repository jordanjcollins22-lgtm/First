import type { NextRequest } from "next/server";

import type { SupabaseClient } from "@supabase/supabase-js";

import { createAdminClient } from "@/lib/supabase/admin";
import { isSupabaseAdminConfigured } from "@/lib/env";
import { photoSpaces, tidyLayout, type Fit } from "@/lib/social-layout";
import { cutPhoto, drawCard } from "@/lib/social/card-picture";

/**
 * The picture for one of the week's posts, drawn from the crew's own
 * photos: the after photo with the hook over it, the before and after side
 * by side, or the brand colours alone. Public, because Facebook and
 * Instagram fetch it by its address when the post goes out; only planned
 * posts are drawn, and a post's id cannot be guessed.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * A crew photo cut to its space in the picture (see cutPhoto). Phone photos
 * run to 12MB, more than the drawing can take whole, so it is always cut
 * first; if cutting fails, the photo is drawn by a short-lived link.
 */
async function photoUrl(
  admin: ReturnType<typeof createAdminClient>,
  id: string | null,
  space: { width: number; height: number },
  crop: unknown,
  fit: Fit,
  backlogId: string | null = null
): Promise<string | null> {
  if (!id && !backlogId) return null;
  // A crew photo by its job_photos row, or a photo uploaded to the backlog
  // (social_photo_backlog, 0376): both live in the job-photos bucket.
  const { data: photo } = id
    ? await admin.from("job_photos").select("path").eq("id", id).maybeSingle()
    : await (admin as unknown as SupabaseClient).from("social_photo_backlog").select("path").eq("id", backlogId!).maybeSingle();
  if (!photo?.path) return null;
  const { data: file } = await admin.storage.from("job-photos").download(photo.path);
  if (!file) return null;
  try {
    return await cutPhoto(Buffer.from(await file.arrayBuffer()), space, crop, fit);
  } catch {
    const { data } = await admin.storage.from("job-photos").createSignedUrl(photo.path, 600);
    return data?.signedUrl ?? null;
  }
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isSupabaseAdminConfigured || !/^[0-9a-f-]{36}$/i.test(id)) return new Response("Not found", { status: 404 });
  const admin = createAdminClient();
  const columns = "id, hook, card_style, before_photo_id, after_photo_id, before_crop, after_crop, layout, plan_day, organization_id";
  const read = (cols: string) =>
    (admin as unknown as SupabaseClient).from("social_posts").select(cols).eq("id", id).not("plan_day", "is", null).maybeSingle();
  // backlog_photo_id arrives with 0376; until then posts are read without it.
  const first = await read(`${columns}, backlog_photo_id`);
  const found = first.error ? (await read(columns)).data : first.data;
  const post = found as unknown as {
    id: string;
    hook: string | null;
    card_style: string | null;
    before_photo_id: string | null;
    after_photo_id: string | null;
    before_crop: unknown;
    after_crop: unknown;
    layout: unknown;
    plan_day: string | null;
    organization_id: string;
    backlog_photo_id?: string | null;
  } | null;
  if (!post) return new Response("Not found", { status: 404 });
  const { data: org } = await admin.from("organizations").select("name, business_phone").eq("id", post.organization_id).maybeSingle();

  // The picture editor previews a layout before it is saved by naming it
  // here; only the layout can be named, never which photos are drawn.
  const asked = request.nextUrl.searchParams.get("layout");
  let layout = tidyLayout(post.layout);
  if (asked) {
    try {
      layout = tidyLayout(JSON.parse(asked));
    } catch {
      // A layout that can't be read draws the saved one.
    }
  }
  const split = post.card_style === "split" && Boolean(post.before_photo_id);
  const spaces = photoSpaces(split ? "split" : "photo", layout);
  const [before, after] = await Promise.all([
    split && spaces.before ? photoUrl(admin, post.before_photo_id, spaces.before, post.before_crop, layout.fit) : Promise.resolve(null),
    post.card_style === "brand"
      ? Promise.resolve(null)
      : photoUrl(admin, post.after_photo_id, spaces.after, post.after_crop, layout.fit, post.after_photo_id ? null : (post.backlog_photo_id ?? null)),
  ]);
  const style = split && before && after ? "split" : post.card_style === "brand" || !after ? "brand" : "photo";
  return drawCard(
    { style, spaces, layout, before, after, hook: post.hook ?? "", name: org?.name ?? "JS Landscaping MD", phone: org?.business_phone ?? "" },
    // Instagram takes JPEG only, so the posting job asks for ?format=jpg.
    request.nextUrl.searchParams.get("format") === "jpg" ? "jpg" : "png"
  );
}
