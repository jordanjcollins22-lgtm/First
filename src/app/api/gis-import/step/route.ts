import { NextResponse, after, type NextRequest } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { env, isSupabaseAdminConfigured } from "@/lib/env";
import { acquireLease, runSteps, tokenMatches } from "@/lib/gis-import-run";
import { serverEnvDiagnostic } from "@/lib/gis-probe";

/**
 * One invocation of the county import, run after the response has gone.
 *
 * The screen that starts an import must not wait for it: ninety thousand
 * parcels take hours, and a browser request is killed in seconds. So this
 * route answers 202 at once and does its pages in `after()`, on the server,
 * inside the function's own time limit, then stops. It never calls itself:
 * a function posting to its own deployment is a loop, and Vercel cuts one
 * off with a 508 after a few hops -- which is exactly what happened to the
 * first ZIP run. What asks for the next invocation is the database, whose
 * scheduler posts here every thirty seconds for any import that is running
 * and not currently leased (see migration 0158).
 *
 * Two ways in: the app's own cron secret, used by the server action that
 * starts a run, or the job's own tick token, used by the scheduler. Neither
 * is ever given to a browser.
 */

export const maxDuration = 60;
export const dynamic = "force-dynamic";

/**
 * What this route's own process can see of its configuration.
 *
 * The same function, the same environment, as the steps themselves -- so if
 * this says CRON_SECRET is present, the steps can authenticate, and if it
 * says absent, the deployment is not receiving it. Reveals presence, length
 * and variable names only; never a value. Needs no secret to call, because
 * it holds none.
 */
export async function GET() {
  return NextResponse.json(serverEnvDiagnostic("route-handler"), {
    headers: { "cache-control": "no-store" },
  });
}

export async function POST(request: NextRequest) {
  if (!isSupabaseAdminConfigured) {
    return NextResponse.json({ error: "Supabase admin isn't configured." }, { status: 503 });
  }

  const body = (await request.json().catch(() => ({}))) as { jobId?: string; token?: string };
  const jobId = typeof body.jobId === "string" ? body.jobId : null;
  if (!jobId) return NextResponse.json({ error: "jobId is required." }, { status: 400 });

  const admin = createAdminClient();

  const secret = env.cronSecret;
  const bearerOk = Boolean(secret) && request.headers.get("authorization") === `Bearer ${secret}`;
  let tokenOk = false;
  if (!bearerOk) {
    const { data: row } = await admin.from("gis_import_jobs").select("tick_token").eq("id", jobId).maybeSingle();
    tokenOk = tokenMatches(row?.tick_token, body.token);
  }
  if (!bearerOk && !tokenOk) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const job = await acquireLease(admin, jobId);
  if (!job) {
    // Paused, finished, or another invocation is on it right now. Not an
    // error: the scheduler asks again in half a minute.
    return NextResponse.json({ accepted: false, reason: "not running or already leased" }, { status: 409 });
  }

  after(async () => {
    try {
      await runSteps(admin, job, "background-job");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("gis import step failed:", message);
      await admin
        .from("gis_import_jobs")
        .update({
          status: "failed",
          lease_until: null,
          last_error: message,
          errors: job.errors + 1,
          updated_at: new Date().toISOString(),
        })
        .eq("id", jobId);
    }
  });

  const checkpoint = (job.checkpoint ?? {}) as { offset?: number };
  return NextResponse.json({ accepted: true, jobId, offset: checkpoint.offset ?? 0, step: job.steps + 1 }, { status: 202 });
}
