import { NextResponse } from "next/server";

import { ghlFunnelFields } from "@/lib/data/ghl-funnel";
import { reviewPagesEnabled } from "@/lib/review-pages";

/** Preview builds only: which contact fields GoHighLevel has and which is read as the funnel. Field names only. */
export const dynamic = "force-dynamic";

export async function GET() {
  if (!reviewPagesEnabled()) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(await ghlFunnelFields());
}
