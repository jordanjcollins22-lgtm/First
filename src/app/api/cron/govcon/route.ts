import type { NextRequest } from "next/server";

import { runPipeline, type Stage } from "@/lib/govcon/pipeline";

// Streaming SAM's ~200 MB daily CSV + document analysis needs headroom.
export const maxDuration = 300;

const STAGES: Stage[] = ["discover", "process", "digest", "entities", "all"];

/**
 * Unattended pipeline entrypoint, called by Vercel Cron (see vercel.json).
 * Vercel sends `Authorization: Bearer $CRON_SECRET` automatically.
 */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const stage = (request.nextUrl.searchParams.get("stage") ?? "process") as Stage;
  if (!STAGES.includes(stage)) return Response.json({ error: `unknown stage ${stage}` }, { status: 400 });

  // Leave ~20s of the function limit for bookkeeping.
  const result = await runPipeline(stage, (maxDuration - 20) * 1000);
  return Response.json(result, { status: result.ok ? 200 : 500 });
}
