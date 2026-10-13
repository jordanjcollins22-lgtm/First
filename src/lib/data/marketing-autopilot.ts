import type { SupabaseClient } from "@supabase/supabase-js";

import {
  normalizeAutopilot,
  normalizeStarted,
  stampStarted,
  type AutopilotSettings,
  type StartedMap,
} from "@/lib/marketing/autopilot-settings";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Reading the autopilot's switches for a business, with whichever client the
 * caller has: the signed-in one on a page, the service role in a cron.
 *
 * Default-on automations need a "first switched on" moment too, so the first
 * read stamps one for every automation that is on and has none, and saves
 * it. From then on that moment is the line it never acts behind.
 *
 * Signed-in users may only read the table (RLS); every write here uses the
 * service role. Stamping a start time is not a choice anyone makes, and a
 * settings change has already been checked as an owner's by the action.
 */

export interface AutopilotState {
  settings: AutopilotSettings;
  started: StartedMap;
  /** False until the table exists; saving needs it. */
  ready: boolean;
}

const untyped = (c: unknown) => c as SupabaseClient;

export async function loadAutopilot(client: unknown, organizationId: string, now = new Date()): Promise<AutopilotState> {
  const sb = untyped(client);
  const { data, error } = await sb
    .from("marketing_autopilot_settings")
    .select("settings, started")
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (error) return { settings: normalizeAutopilot(null), started: {}, ready: false };
  const settings = normalizeAutopilot(data?.settings);
  const stamped = stampStarted(settings, normalizeStarted(data?.started), now);
  if (stamped.changed || !data) {
    try {
      const { error: saveError } = await untyped(createAdminClient())
        .from("marketing_autopilot_settings")
        .upsert({
          organization_id: organizationId,
          settings: data?.settings ?? {},
          started: stamped.started,
          updated_at: now.toISOString(),
        });
      if (saveError) throw saveError;
    } catch (err) {
      // Not saved means nothing acts yet: an automation with no start time is
      // treated as not started (mayActOn), so failing here is the safe way.
      console.error("[autopilot] could not stamp start times:", err instanceof Error ? err.message : err);
      return { settings, started: normalizeStarted(data?.started), ready: true };
    }
  }
  return { settings, started: stamped.started, ready: true };
}

/** Saves the owner's settings. The caller has checked the person is an owner. */
export async function saveAutopilot(organizationId: string, settings: AutopilotSettings, by: string | null, now = new Date()): Promise<StartedMap> {
  const sb = untyped(createAdminClient());
  const { data } = await sb.from("marketing_autopilot_settings").select("started").eq("organization_id", organizationId).maybeSingle();
  const { started } = stampStarted(settings, normalizeStarted(data?.started), now);
  const { error } = await sb.from("marketing_autopilot_settings").upsert({
    organization_id: organizationId,
    settings,
    started,
    updated_at: now.toISOString(),
    updated_by: by,
  });
  if (error) throw error;
  return started;
}
