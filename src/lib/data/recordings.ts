import type { SupabaseClient } from "@supabase/supabase-js";

import { createAdminClient } from "@/lib/supabase/admin";
import { RECORDING_BUCKET } from "@/lib/hiring/recordings";

/** Reading recorded hiring calls back. Who may is checked by the caller. */

const sb = (): SupabaseClient => createAdminClient() as unknown as SupabaseClient;

/** Whether a recording is really in storage: a signed link only comes back for a file that exists. */
export async function recordingExists(path: string): Promise<boolean> {
  const { data } = await sb().storage.from(RECORDING_BUCKET).createSignedUrl(path, 60);
  return !!data?.signedUrl;
}

/** A link to play each recording for the next hour, by path. */
export async function recordingUrls(paths: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const unique = [...new Set(paths.filter(Boolean))];
  if (unique.length === 0) return out;
  const { data } = await sb().storage.from(RECORDING_BUCKET).createSignedUrls(unique, 60 * 60);
  for (const d of data ?? []) if (d.path && d.signedUrl) out.set(d.path, d.signedUrl);
  return out;
}
