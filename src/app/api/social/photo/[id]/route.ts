import type { NextRequest } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentProfile } from "@/lib/data/team";
import { isSupabaseAdminConfigured } from "@/lib/env";

/**
 * A crew photo, small and upright, for choosing the pictures of a post.
 * Only for somebody signed in to the business the photo belongs to: these
 * are private until a post with them is approved.
 */
export const dynamic = "force-dynamic";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isSupabaseAdminConfigured || !/^[0-9a-f-]{36}$/i.test(id)) return new Response("Not found", { status: 404 });
  const profile = await getCurrentProfile();
  if (!profile) return new Response("Sign in first.", { status: 401 });
  const admin = createAdminClient();
  const { data: photo } = await admin.from("job_photos").select("path, organization_id").eq("id", id).maybeSingle();
  if (!photo?.path || photo.organization_id !== profile.organization_id) return new Response("Not found", { status: 404 });
  const { data: file } = await admin.storage.from("job-photos").download(photo.path);
  if (!file) return new Response("Not found", { status: 404 });
  const sharp = (await import("sharp")).default;
  const small = await sharp(Buffer.from(await file.arrayBuffer())).rotate().resize({ width: 640, height: 640, fit: "inside" }).jpeg({ quality: 78 }).toBuffer();
  return new Response(new Uint8Array(small), {
    headers: { "content-type": "image/jpeg", "cache-control": "private, max-age=86400" },
  });
}
