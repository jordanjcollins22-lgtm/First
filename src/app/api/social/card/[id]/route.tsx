/* eslint-disable @next/next/no-img-element -- drawn into a PNG by ImageResponse, not a page */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import type { NextRequest } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { isSupabaseAdminConfigured } from "@/lib/env";
import { cropBox, tidyCrop } from "@/lib/social-crop";
import { CARD, GAP, barSize, headline, photoSpaces, tidyLayout, type Fit } from "@/lib/social-layout";

/**
 * The picture for one of the week's posts, drawn from the crew's own
 * photos: the after photo with the hook over it, the before and after side
 * by side, or the brand colours alone. Public, because Facebook and
 * Instagram fetch it by its address when the post goes out; only planned
 * posts are drawn, and a post's id cannot be guessed.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const W = CARD.width;
const H = CARD.height;
const GREEN = "#2f6d3c";
const DARK = "#14261a";

/**
 * A crew photo cut to its space in the picture: turned upright from the
 * phone's own record of which way was up, scaled to fill the space, zoomed
 * and moved to where the owner placed it, or shown whole on the dark
 * background when the layout says so. Phone photos run to 12MB, more than
 * the drawing can take whole, so it is always cut first.
 */
async function photoUrl(
  admin: ReturnType<typeof createAdminClient>,
  id: string | null,
  space: { width: number; height: number },
  crop: unknown,
  fit: Fit
): Promise<string | null> {
  if (!id) return null;
  const { data: photo } = await admin.from("job_photos").select("path").eq("id", id).maybeSingle();
  if (!photo?.path) return null;
  const { data: file } = await admin.storage.from("job-photos").download(photo.path);
  if (!file) return null;
  try {
    const sharp = (await import("sharp")).default;
    const upright = await sharp(Buffer.from(await file.arrayBuffer())).rotate().toBuffer({ resolveWithObject: true });
    if (fit === "whole") {
      const whole = await sharp(upright.data)
        .resize(space.width, space.height, { fit: "contain", background: DARK })
        .jpeg({ quality: 84 })
        .toBuffer();
      return `data:image/jpeg;base64,${whole.toString("base64")}`;
    }
    const box = cropBox(upright.info.width, upright.info.height, space.width, space.height, tidyCrop(crop));
    const cut = await sharp(upright.data)
      .resize(box.width, box.height)
      .extract({ left: box.left, top: box.top, width: space.width, height: space.height })
      .jpeg({ quality: 84 })
      .toBuffer();
    return `data:image/jpeg;base64,${cut.toString("base64")}`;
  } catch {
    const { data } = await admin.storage.from("job-photos").createSignedUrl(photo.path, 600);
    return data?.signedUrl ?? null;
  }
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isSupabaseAdminConfigured || !/^[0-9a-f-]{36}$/i.test(id)) return new Response("Not found", { status: 404 });
  const admin = createAdminClient();
  const { data: post } = await admin
    .from("social_posts")
    .select("id, hook, card_style, before_photo_id, after_photo_id, before_crop, after_crop, layout, plan_day, organization_id")
    .eq("id", id)
    .not("plan_day", "is", null)
    .maybeSingle();
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
    post.card_style === "brand" ? Promise.resolve(null) : photoUrl(admin, post.after_photo_id, spaces.after, post.after_crop, layout.fit),
  ]);
  const style = split && before && after ? "split" : post.card_style === "brand" || !after ? "brand" : "photo";
  const [bold, logoData] = await Promise.all([
    readFile(join(process.cwd(), "assets/fonts/Montserrat-ExtraBold.ttf")),
    readFile(join(process.cwd(), "public/logo-mark.png"), "base64"),
  ]);
  const logo = `data:image/png;base64,${logoData}`;
  const hook = (post.hook ?? "").trim();
  const name = org?.name ?? "JS Landscaping MD";
  const phone = org?.business_phone ?? "";

  const bar = barSize(layout.bar);
  const brandBar = (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%", height: bar.height, flexShrink: 0, padding: `0 ${bar.padX}px`, background: GREEN, color: "white" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
        <img alt="" src={logo} width={bar.logo} height={bar.logo} />
        <div style={{ display: "flex", fontSize: bar.font, fontWeight: 700 }}>{name}</div>
      </div>
      <div style={{ display: "flex", fontSize: bar.font, fontWeight: 700 }}>{phone}</div>
    </div>
  );

  const label = (text: string) => (
    <div style={{ display: "flex", position: "absolute", top: 28, left: 28, padding: "10px 22px", borderRadius: 999, background: text === "AFTER" ? GREEN : "rgba(0,0,0,0.65)", color: "white", fontSize: 32, fontWeight: 800, letterSpacing: 2 }}>
      {text}
    </div>
  );

  let picture;
  const font = { fontFamily: "Montserrat" } as const;
  const words = headline(layout.text, style === "split" ? "split" : "photo");
  if (style === "split" && spaces.before) {
    const side = layout.arrange === "side";
    picture = (
      <div style={{ ...font, display: "flex", flexDirection: "column", width: "100%", height: H, background: DARK }}>
        <div style={{ display: "flex", flexDirection: side ? "row" : "column", gap: GAP, background: "white", width: W, height: H - bar.height - words.panel }}>
          <div style={{ display: "flex", position: "relative", width: spaces.before.width, height: spaces.before.height }}>
            <img alt="" src={before!} width={spaces.before.width} height={spaces.before.height} />
            {label("BEFORE")}
          </div>
          <div style={{ display: "flex", position: "relative", width: spaces.after.width, height: spaces.after.height }}>
            <img alt="" src={after!} width={spaces.after.width} height={spaces.after.height} />
            {label("AFTER")}
          </div>
        </div>
        {words.panel > 0 && hook && (
          <div style={{ display: "flex", alignItems: "center", height: words.panel, padding: "0 48px", color: "white", fontSize: words.font, fontWeight: 800, lineHeight: 1.15 }}>{hook}</div>
        )}
        {brandBar}
      </div>
    );
  } else if (style === "photo") {
    picture = (
      <div style={{ ...font, display: "flex", position: "relative", width: W, height: H, background: DARK }}>
        <img alt="" src={after!} width={W} height={H} style={{ position: "absolute", top: 0, left: 0 }} />
        <div style={{ display: "flex", flexDirection: "column", justifyContent: "flex-end", position: "absolute", top: 0, left: 0, width: W, height: H, backgroundImage: "linear-gradient(to bottom, rgba(0,0,0,0) 40%, rgba(0,0,0,0.85) 82%)" }}>
          {words.font > 0 && hook && <div style={{ display: "flex", padding: "0 48px 40px", color: "white", fontSize: words.font, fontWeight: 800, lineHeight: 1.1 }}>{hook}</div>}
          {brandBar}
        </div>
      </div>
    );
  } else {
    picture = (
      <div style={{ ...font, display: "flex", flexDirection: "column", width: W, height: H, background: `linear-gradient(160deg, ${GREEN} 0%, ${DARK} 100%)`, color: "white" }}>
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
    fonts: [{ name: "Montserrat", data: bold, weight: 800, style: "normal" }],
    headers: { "cache-control": "public, max-age=300, s-maxage=300" },
  });
}
