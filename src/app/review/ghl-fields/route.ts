import { NextResponse } from "next/server";

import { ghlFunnelFields, scanGhlFields } from "@/lib/data/ghl-funnel";
import { reviewScope } from "@/lib/data/review-scope";
import { reviewPagesEnabled } from "@/lib/review-pages";

/** Preview builds only: which contact fields GoHighLevel has and which is read as the funnel. Field names only. */
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!reviewPagesEnabled()) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (new URL(request.url).searchParams.get("scan")) return NextResponse.json(await scanGhlFields(await reviewScope()));
  return NextResponse.json(await ghlFunnelFields());
}
