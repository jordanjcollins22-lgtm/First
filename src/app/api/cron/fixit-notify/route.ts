import { NextResponse, type NextRequest } from "next/server";

import { authorizeScheduledCall } from "@/lib/cron-auth";
import { isSupabaseAdminConfigured } from "@/lib/env";
import { postToWebhook } from "@/lib/fixit/discord-api";
import { buildReadyMessages } from "@/lib/fixit/messages";
import { buildsToNotify, discordConfigForOrg, markNotified, ticketsInBuild } from "@/lib/fixit/store";
import { log } from "@/lib/log";

/**
 * Posts each finished fix-it build to the owner's Discord channel: the
 * summary, the preview link and a line per ticket, through the webhook saved
 * with the Discord integration. The build job sets a build "ready" or
 * "failed"; this finds those not posted yet (notified_at is null), posts
 * them and stamps notified_at, so each is posted once. Meant for pg_cron
 * every few minutes. A business without a webhook saved is skipped and
 * tried again next time.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  if (!isSupabaseAdminConfigured) return NextResponse.json({ error: "Supabase admin isn't configured." }, { status: 503 });
  const refused = await authorizeScheduledCall(request, "fixit-notify");
  if (refused) return refused;

  const runs: Record<string, unknown>[] = [];
  let builds;
  try {
    builds = await buildsToNotify();
  } catch (err) {
    log.error("cron.fixit_notify", err);
    return NextResponse.json({ error: "Couldn't read builds. Is migration 0368 applied?" }, { status: 500 });
  }

  for (const build of builds) {
    try {
      const config = await discordConfigForOrg(build.organization_id);
      if (!config?.webhookUrl) {
        runs.push({ build: build.number, skipped: "no webhook saved" });
        continue;
      }
      const tickets = await ticketsInBuild(build.id);
      const messages = buildReadyMessages(
        { number: build.number, status: build.status, summary: build.summary, previewUrl: build.preview_url, branch: build.branch },
        tickets
      );
      let error: string | null = null;
      for (const message of messages) {
        const r = await postToWebhook(config.webhookUrl, message);
        if (!r.ok) {
          error = r.error;
          break;
        }
      }
      if (error) {
        log.warn("cron.fixit_notify.post_failed", { build: build.number, error });
        runs.push({ build: build.number, error });
        continue;
      }
      await markNotified(build.id);
      runs.push({ build: build.number, posted: messages.length });
    } catch (err) {
      log.error("cron.fixit_notify", err, { build: build.number });
      runs.push({ build: build.number, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return NextResponse.json({ ok: true, runs });
}
