import type { NextRequest } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { isSupabaseAdminConfigured } from "@/lib/env";

/**
 * An approved studio post's square, as a JPEG, for Instagram, which takes
 * nothing else. The studio saves PNGs to the public social-posts bucket, so
 * this shows nothing that isn't public already: only a post that was
 * approved (scheduled or posted) and has a saved square, by an id that
 * cannot be guessed.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isSupabaseAdminConfigured || !/^[0-9a-f-]{36}$/i.test(id)) return new Response("Not found", { status: 404 });
  const admin = createAdminClient();
  const { data: post } = await admin
    .from("social_posts")
    .select("image_path, status")
    .eq("id", id)
    .in("status", ["scheduled", "posted"])
    .maybeSingle();
  if (!post?.image_path) return new Response("Not found", { status: 404 });
  const { data: file } = await admin.storage.from("social-posts").download(post.image_path);
  if (!file) return new Response("Not found", { status: 404 });
  const sharp = (await import("sharp")).default;
  const jpeg = await sharp(Buffer.from(await file.arrayBuffer()))
    .rotate()
    .resize({ width: 1440, height: 1440, fit: "inside", withoutEnlargement: true })
    .flatten({ background: "#ffffff" })
    .jpeg({ quality: 90 })
    .toBuffer();
  return new Response(new Uint8Array(jpeg), {
    headers: { "content-type": "image/jpeg", "cache-control": "public, max-age=300, s-maxage=300" },
  });
}
