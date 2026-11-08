import { NextResponse } from "next/server";

import { scanGhlAffiliate } from "@/lib/data/ghl-affiliate-scan";
import { reviewScope } from "@/lib/data/review-scope";
import { reviewPagesEnabled } from "@/lib/review-pages";

/** TEMPORARY preview check: how GoHighLevel tags where calendar bookings came from. Counts only. */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  if (!reviewPagesEnabled()) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(await scanGhlAffiliate(await reviewScope()));
}
