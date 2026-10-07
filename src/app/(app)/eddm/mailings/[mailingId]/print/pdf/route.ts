import { checkTabAccess } from "@/lib/data/access";
import { getEddmMailing } from "@/lib/data/eddm";
import { getFlyerToPrint } from "@/lib/data/flyer-print";
import { clampLoad } from "@/lib/flyer-print";
import { renderFlyerLoad } from "@/lib/flyer-render";

/**
 * One load of a mailing's flyers, as the print file.
 *
 * ?from=51&count=50 is flyers 51 to 100: a hundred pages, front and back of
 * each, so the printer is sent exactly the flyers for the paper in the tray.
 * Never more than the mailing has left, and never more than a tray holds.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request, { params }: { params: Promise<{ mailingId: string }> }) {
  const { allowed, profile } = await checkTabAccess("project-data");
  if (!profile) return new Response("Sign in first.", { status: 401 });
  if (!allowed) return new Response("Not yours to open.", { status: 403 });

  const { mailingId } = await params;
  const mailing = await getEddmMailing(mailingId);
  if (!mailing) return new Response("No such mailing.", { status: 404 });

  const search = new URL(request.url).searchParams;
  const { from, count } = clampLoad(Number(search.get("from")), Number(search.get("count")), mailing.pieces);
  const { art } = await getFlyerToPrint();
  const bytes = await renderFlyerLoad(art, count);

  const to = from + count - 1;
  const name = count === 1 ? "flyer-test.pdf" : `flyers-${from}-to-${to}.pdf`;
  return new Response(bytes as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${search.get("download") === "1" ? "attachment" : "inline"}; filename="${name}"`,
      "Content-Length": String(bytes.length),
      "Cache-Control": "private, max-age=0, must-revalidate",
    },
  });
}
