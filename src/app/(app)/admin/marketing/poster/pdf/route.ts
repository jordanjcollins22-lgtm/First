import { checkTabAccess } from "@/lib/data/access";
import { getCurrentOrganization } from "@/lib/data/organizations";
import { posterBookingPath } from "@/lib/neighborhood-poster";
import { renderPoster } from "@/lib/poster-render";

/**
 * The neighbourhood sign, as a file the office printer can take.
 *
 * A twenty by thirty frame is not a size any printer here can make, and a
 * print shop is a day and a drive for a sign that goes out this afternoon. So
 * it comes back as letter sheets to cut out and tape together, drawn at the
 * real size rather than scaled up from a picture.
 *
 * The size is a parameter because frames vary. Twenty by thirty is the
 * default; ?w=24&h=36 is a different frame and the same sign.
 */
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { allowed, profile } = await checkTabAccess("door-hangers");
  if (!profile) return new Response("Sign in first.", { status: 401 });
  if (!allowed) return new Response("Not yours to open.", { status: 403 });

  const params = new URL(request.url).searchParams;
  const width = clamp(Number(params.get("w")) || 20, 8, 60);
  const height = clamp(Number(params.get("h")) || 30, 8, 96);
  const download = params.get("download") === "1";

  const organization = await getCurrentOrganization();
  const origin = new URL(request.url).origin;

  const { bytes } = await renderPoster({
    width,
    height,
    businessName: organization.name,
    bookingUrl: `${origin}${posterBookingPath(organization.slug)}`,
  });

  const name = `neighborhood-sign-${width}x${height}.pdf`;
  return new Response(bytes as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${name}"`,
      "Content-Length": String(bytes.length),
      // Not "no-store": Safari's viewer wants to hold the file it is showing.
      "Cache-Control": "private, max-age=0, must-revalidate",
    },
  });
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}
