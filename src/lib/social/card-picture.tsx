/* eslint-disable @next/next/no-img-element -- drawn into a PNG by ImageResponse, not a page */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";

import { cropBox, tidyCrop } from "@/lib/social-crop";
import { CARD, GAP, barSize, headline, type Fit, type Layout, type Spaces } from "@/lib/social-layout";

/**
 * Drawing a post's picture: the after photo with the hook over it, the
 * before and after stacked or side by side, or the brand colours alone,
 * with the green bar along the bottom. Used by the picture route that
 * Facebook and Instagram fetch, and by the preview review page with its
 * sample photos, so both draw exactly the same picture.
 */

const W = CARD.width;
const H = CARD.height;
const GREEN = "#0f766e";
const DARK = "#14261a";

/**
 * A photo cut to its space in the picture: turned upright from the phone's
 * own record of which way was up, scaled to fill the space, zoomed and
 * moved to where the owner placed it, or shown whole on the dark background
 * when the layout says so. Returned as a data URL to draw.
 */
export async function cutPhoto(data: Buffer, space: { width: number; height: number }, crop: unknown, fit: Fit): Promise<string> {
  const sharp = (await import("sharp")).default;
  const upright = await sharp(data).rotate().toBuffer({ resolveWithObject: true });
  if (fit === "whole") {
    const whole = await sharp(upright.data).resize(space.width, space.height, { fit: "contain", background: DARK }).jpeg({ quality: 84 }).toBuffer();
    return `data:image/jpeg;base64,${whole.toString("base64")}`;
  }
  const box = cropBox(upright.info.width, upright.info.height, space.width, space.height, tidyCrop(crop));
  const cut = await sharp(upright.data)
    .resize(box.width, box.height)
    .extract({ left: box.left, top: box.top, width: space.width, height: space.height })
    .jpeg({ quality: 84 })
    .toBuffer();
  return `data:image/jpeg;base64,${cut.toString("base64")}`;
}

export interface CardInput {
  /** What to draw: "split" needs both photos, "photo" the after photo. */
  style: "split" | "photo" | "brand";
  spaces: Spaces;
  layout: Layout;
  before: string | null;
  after: string | null;
  hook: string;
  name: string;
  phone: string;
}

/** The picture, drawn: a PNG, or a JPEG when asked (Instagram takes JPEG only). */
export async function drawCard(input: CardInput, format: "png" | "jpg" = "png"): Promise<Response> {
  const { style, spaces, layout, before, after, name, phone } = input;
  const hook = input.hook.trim();
  const [bold, logoData] = await Promise.all([
    readFile(join(process.cwd(), "assets/fonts/Montserrat-ExtraBold.ttf")),
    readFile(join(process.cwd(), "public/logo-mark.png"), "base64"),
  ]);
  const logo = `data:image/png;base64,${logoData}`;

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
  if (style === "split" && spaces.before && before && after) {
    const side = layout.arrange === "side";
    picture = (
      <div style={{ ...font, display: "flex", flexDirection: "column", width: "100%", height: H, background: DARK }}>
        <div style={{ display: "flex", flexDirection: side ? "row" : "column", gap: GAP, background: "white", width: W, height: H - bar.height - words.panel }}>
          <div style={{ display: "flex", position: "relative", width: spaces.before.width, height: spaces.before.height }}>
            <img alt="" src={before} width={spaces.before.width} height={spaces.before.height} />
            {label("BEFORE")}
          </div>
          <div style={{ display: "flex", position: "relative", width: spaces.after.width, height: spaces.after.height }}>
            <img alt="" src={after} width={spaces.after.width} height={spaces.after.height} />
            {label("AFTER")}
          </div>
        </div>
        {words.panel > 0 && hook && (
          <div style={{ display: "flex", alignItems: "center", height: words.panel, padding: "0 48px", color: "white", fontSize: words.font, fontWeight: 800, lineHeight: 1.15 }}>{hook}</div>
        )}
        {brandBar}
      </div>
    );
  } else if (style === "photo" && after) {
    picture = (
      <div style={{ ...font, display: "flex", position: "relative", width: W, height: H, background: DARK }}>
        <img alt="" src={after} width={W} height={H} style={{ position: "absolute", top: 0, left: 0 }} />
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

  const drawn = new ImageResponse(picture, {
    width: W,
    height: H,
    fonts: [{ name: "Montserrat", data: bold, weight: 800, style: "normal" }],
    headers: { "cache-control": "public, max-age=300, s-maxage=300" },
  });
  if (format !== "jpg") return drawn;
  const sharp = (await import("sharp")).default;
  const jpeg = await sharp(Buffer.from(await drawn.arrayBuffer())).flatten({ background: "#ffffff" }).jpeg({ quality: 90 }).toBuffer();
  return new Response(new Uint8Array(jpeg), {
    headers: { "content-type": "image/jpeg", "cache-control": "public, max-age=300, s-maxage=300" },
  });
}
