/* eslint-disable @next/next/no-img-element -- drawn into a PNG by ImageResponse, not a page */
import { ImageResponse } from "next/og";
import type { NextRequest } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { isSupabaseAdminConfigured } from "@/lib/env";

/**
 * The picture for one of the week's posts, drawn from the crew's own
 * photos: the after photo with the hook over it, the before and after side
 * by side, or the brand colours alone. Public, because Facebook and
 * Instagram fetch it by its address when the post goes out; only planned
 * posts are drawn, and a post's id cannot be guessed.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const W = 1080;
const H = 1350;
const GREEN = "#2f6d3c";
const DARK = "#14261a";

async function photoUrl(admin: ReturnType<typeof createAdminClient>, id: string | null): Promise<string | null> {
  if (!id) return null;
  const { data: photo } = await admin.from("job_photos").select("path").eq("id", id).maybeSingle();
  if (!photo?.path) return null;
  const { data } = await admin.storage.from("job-photos").createSignedUrl(photo.path, 600);
  return data?.signedUrl ?? null;
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isSupabaseAdminConfigured || !/^[0-9a-f-]{36}$/i.test(id)) return new Response("Not found", { status: 404 });
  const admin = createAdminClient();
  const { data: post } = await admin
    .from("social_posts")
    .select("id, hook, card_style, before_photo_id, after_photo_id, plan_day, organization_id")
    .eq("id", id)
    .not("plan_day", "is", null)
    .maybeSingle();
  if (!post) return new Response("Not found", { status: 404 });
  const { data: org } = await admin.from("organizations").select("name, business_phone").eq("id", post.organization_id).maybeSingle();

  const [before, after] = await Promise.all([photoUrl(admin, post.before_photo_id), photoUrl(admin, post.after_photo_id)]);
  const style = post.card_style === "split" && before && after ? "split" : post.card_style === "brand" || !after ? "brand" : "photo";
  const logo = `${request.nextUrl.origin}/logo-mark.png`;
  const hook = (post.hook ?? "").trim();
  const name = org?.name ?? "JS Landscaping MD";
  const phone = org?.business_phone ?? "";

  const brandBar = (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%", padding: "28px 48px", background: GREEN, color: "white" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
        <img alt="" src={logo} width={64} height={64} style={{ borderRadius: 14, background: "white" }} />
        <div style={{ display: "flex", fontSize: 34, fontWeight: 700 }}>{name}</div>
      </div>
      <div style={{ display: "flex", fontSize: 34, fontWeight: 700 }}>{phone}</div>
    </div>
  );

  const label = (text: string) => (
    <div style={{ display: "flex", position: "absolute", top: 28, left: 28, padding: "10px 22px", borderRadius: 999, background: text === "AFTER" ? GREEN : "rgba(0,0,0,0.65)", color: "white", fontSize: 32, fontWeight: 800, letterSpacing: 2 }}>
      {text}
    </div>
  );

  let picture;
  if (style === "split") {
    picture = (
      <div style={{ display: "flex", flexDirection: "column", width: "100%", height: H, background: DARK }}>
        <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
          <div style={{ display: "flex", position: "relative", width: W, height: 470 }}>
            <img alt="" src={before!} width={W} height={470} style={{ objectFit: "cover" }} />
            {label("BEFORE")}
          </div>
          <div style={{ display: "flex", position: "relative", width: W, height: 470, borderTop: "8px solid white" }}>
            <img alt="" src={after!} width={W} height={462} style={{ objectFit: "cover" }} />
            {label("AFTER")}
          </div>
        </div>
        <div style={{ display: "flex", padding: "36px 48px", color: "white", fontSize: 58, fontWeight: 800, lineHeight: 1.15 }}>{hook}</div>
        {brandBar}
      </div>
    );
  } else if (style === "photo") {
    picture = (
      <div style={{ display: "flex", position: "relative", width: W, height: H, background: DARK }}>
        <img alt="" src={after!} width={W} height={H} style={{ objectFit: "cover", position: "absolute", top: 0, left: 0 }} />
        <div style={{ display: "flex", flexDirection: "column", justifyContent: "flex-end", position: "absolute", top: 0, left: 0, width: W, height: H, backgroundImage: "linear-gradient(to bottom, rgba(0,0,0,0) 40%, rgba(0,0,0,0.85) 82%)" }}>
          <div style={{ display: "flex", padding: "0 48px 40px", color: "white", fontSize: 72, fontWeight: 800, lineHeight: 1.1 }}>{hook}</div>
          {brandBar}
        </div>
      </div>
    );
  } else {
    picture = (
      <div style={{ display: "flex", flexDirection: "column", width: W, height: H, background: `linear-gradient(160deg, ${GREEN} 0%, ${DARK} 100%)`, color: "white" }}>
        <div style={{ display: "flex", flex: 1, flexDirection: "column", justifyContent: "center", padding: "0 80px" }}>
          <div style={{ display: "flex", fontSize: 96, fontWeight: 800, lineHeight: 1.08 }}>{hook}</div>
          <div style={{ display: "flex", marginTop: 40, fontSize: 40, opacity: 0.85 }}>Harford County, Maryland</div>
        </div>
        {brandBar}
      </div>
    );
  }

  return new ImageResponse(picture, {
    width: W,
    height: H,
    headers: { "cache-control": "public, max-age=300, s-maxage=300" },
  });
}
