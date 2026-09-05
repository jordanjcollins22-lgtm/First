import { NextResponse, after, type NextRequest } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { env, isSupabaseAdminConfigured } from "@/lib/env";
import { acquireLease, kickStep, runStep, selfBaseUrl } from "@/lib/gis-import-run";
import { serverEnvDiagnostic } from "@/lib/gis-probe";

/**
 * One step of a county import, run after the response has gone.
 *
 * The screen that starts an import must not wait for it: ninety thousand
 * parcels take hours, and a browser request is killed in seconds. So this
 * route answers 202 at once, and does one page's work in `after()`, on the
 * server, inside the function's own time limit. When the page is done and
 * there is more, it posts to itself for the next one. A job therefore runs
 * as a chain of short server invocations, each of which can die without
 * losing anything but the page it was on -- and that page is re-done on
 * resume because every write in the runner is idempotent.
 *
 * Called with the cron secret, by the app itself, never by a browser.
 */

export const maxDuration = 60;
export const dynamic = "force-dynamic";

/** A stop against a chain that never ends. The whole county is a few hundred steps. */
const MAX_STEPS = 2_000;

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

  const secret = env.cronSecret;
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET is not set, so background steps cannot authenticate." }, { status: 503 });
  }
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as { jobId?: string };
  const jobId = typeof body.jobId === "string" ? body.jobId : null;
  if (!jobId) return NextResponse.json({ error: "jobId is required." }, { status: 400 });

  const admin = createAdminClient();
  const job = await acquireLease(admin, jobId);
  if (!job) {
    // Paused, finished, or another step is on it right now. Not an error:
    // whoever holds the lease will chain the next step if there is one.
    return NextResponse.json({ accepted: false, reason: "not running or already leased" }, { status: 409 });
  }

  const base = selfBaseUrl(new URL(request.url).origin);

  after(async () => {
    try {
      const outcome = await runStep(admin, job, "background-job");
      if (outcome.more && outcome.status === "running") {
        if (job.steps + 1 >= MAX_STEPS) {
          await admin
            .from("gis_import_jobs")
            .update({ status: "paused", last_error: `Stopped after ${MAX_STEPS} steps as a safeguard. Resume to continue.` })
            .eq("id", jobId);
          return;
        }
        await kickStep(base, jobId);
      }
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
