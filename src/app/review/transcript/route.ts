import { NextResponse, type NextRequest } from "next/server";

import { reviewPagesEnabled } from "@/lib/review-pages";
import { youtubeId } from "@/lib/video-notes";
import { fetchTranscript } from "@/lib/youtube-transcript";

/** Preview builds only: checks the transcript fetch works from where the app runs. Sends back the size, not the words. */
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!reviewPagesEnabled()) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const id = youtubeId(request.nextUrl.searchParams.get("v") ?? "");
  if (!id) return NextResponse.json({ error: "Pass ?v= a YouTube link or id." }, { status: 400 });
  const got = await fetchTranscript(id);
  return NextResponse.json(got.ok ? { ok: true, title: got.title, seconds: got.seconds, chars: got.text.length, start: got.text.slice(0, 120) } : got);
}
