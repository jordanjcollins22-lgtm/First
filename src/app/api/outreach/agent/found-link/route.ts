import { NextResponse, type NextRequest } from "next/server";

import { getCurrentProfile } from "@/lib/data/team";
import { reportHunt } from "@/lib/data/link-hunt";

/**
 * The extension's answer for a post it went back for: the link it found,
 * with the words of the post it came from, or nothing. The link is kept
 * only when the words are that post's own.
 */
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const profile = await getCurrentProfile();
  if (!profile) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  let body: { id?: unknown; url?: unknown; text?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }
  if (typeof body.id !== "string" || !/^[0-9a-f-]{36}$/i.test(body.id)) return NextResponse.json({ error: "Bad request." }, { status: 400 });
  const result = await reportHunt(
    profile.organization_id,
    {
      id: body.id,
      url: typeof body.url === "string" ? body.url.slice(0, 600) : null,
      text: typeof body.text === "string" ? body.text.slice(0, 4000) : null,
    },
    new Date()
  );
  return NextResponse.json({ ok: true, ...result });
}
