import { NextResponse, type NextRequest } from "next/server";

import { getCurrentProfile } from "@/lib/data/team";
import { importReviews } from "@/lib/data/review-sources";

/**
 * The reviews page the browser read.
 *
 * The extension, signed in as the owner, opens the business's Facebook
 * Reviews tab or Google listing and sends the page's text here. The reviews
 * are picked out of it, and only the five-star ones with something written
 * go on the booking page. Signed in with the app's own cookies, like every
 * other call the extension makes.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: NextRequest) {
  const profile = await getCurrentProfile();
  if (!profile) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const body = (await request.json().catch(() => null)) as { sourceId?: unknown; text?: unknown } | null;
  const sourceId = typeof body?.sourceId === "string" ? body.sourceId : null;
  const text = typeof body?.text === "string" ? body.text.slice(0, 150_000) : "";
  if (!sourceId) return NextResponse.json({ error: "Which page was this?" }, { status: 400 });

  const result = await importReviews(profile.organization_id, sourceId, text);
  return NextResponse.json(result, { status: result.ok ? 200 : 422 });
}
