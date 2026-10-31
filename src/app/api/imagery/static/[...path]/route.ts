import { NextResponse, type NextRequest } from "next/server";

import { drawStaticPicture } from "@/lib/data/imagery";

/**
 * A satellite picture from the newest aerial photos covering the place,
 * asked for exactly like a Mapbox static image:
 * /api/imagery/static/pin-s+2f6d3c(lng,lat)/lng,lat,zoom,bearing/WxH@2x
 *
 * Public, like the pages that show it (booking, the pre-evaluation, the
 * estimate), and cached hard: the same picture of the same place doesn't
 * change until the next flight, and every draw costs the county's server.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  try {
    const picture = await drawStaticPicture(path.map(decodeURIComponent).join("/"));
    return new NextResponse(new Uint8Array(picture.body), {
      headers: {
        "Content-Type": picture.contentType,
        "Cache-Control": "public, max-age=86400, s-maxage=2592000, stale-while-revalidate=86400",
        "X-Imagery-Source": picture.source,
        "X-Imagery-Credit": picture.credit,
      },
    });
  } catch {
    return NextResponse.json({ error: "No satellite picture for that." }, { status: 502 });
  }
}
