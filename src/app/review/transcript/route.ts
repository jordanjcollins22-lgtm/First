import { NextResponse, type NextRequest } from "next/server";

import { reviewPagesEnabled } from "@/lib/review-pages";
import { readVideo } from "@/lib/actions/video-notes-actions";
import { youtubeId } from "@/lib/video-notes";
import { fetchTranscript, trace } from "@/lib/youtube-transcript";

/** Preview builds only: checks the transcript fetch works from where the app runs. Sends back the size, not the words. */
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!reviewPagesEnabled()) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (request.nextUrl.searchParams.get("sample")) {
    trace.length = 0;
    // Checks the pasted-transcript path end to end, AI included, with a short made-up transcript.
    const pasted =
      "Today I'll show you how to edge a flower bed. First, mark the line with a garden hose so the curve looks natural. " +
      "Then cut straight down about four inches with a half-moon edger. Angle the bed side at forty-five degrees so mulch stays in. " +
      "The biggest mistake is going too shallow, because grass grows right back in two weeks. Finish with two inches of mulch, never more than three.";
    const r = await readVideo({ link: request.nextUrl.searchParams.get("v") ?? "", know: "I mow lawns", want: ["Mistakes to avoid"], pasted });
    return NextResponse.json({ ...r, steps: [...trace] });
  }
  const id = youtubeId(request.nextUrl.searchParams.get("v") ?? "");
  if (!id) return NextResponse.json({ error: "Pass ?v= a YouTube link or id." }, { status: 400 });
  trace.length = 0;
  const got = await fetchTranscript(id);
  const steps = [...trace];
  return NextResponse.json(got.ok ? { ok: true, title: got.title, seconds: got.seconds, chars: got.text.length, start: got.text.slice(0, 120), steps } : { ...got, steps });
}
