import { createHash, randomBytes } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import { appBaseUrl } from "@/lib/env";
import type { Database } from "@/lib/supabase/database.types";

type Db = SupabaseClient<Database>;

/** Links stop working after this long unless a shorter time is asked for. */
export const DEFAULT_LINK_TTL_HOURS = 72;

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Make a no-login link for one employee to one thing (today: a job's crew
 * plan). Only the hash is stored, so a database leak doesn't leak links.
 */
export async function createEmployeeLink(
  supabase: Db,
  input: { teamMemberId: string; kind: "job"; jobId: string; ttlHours?: number }
): Promise<{ url: string; expiresAt: string }> {
  const token = randomBytes(24).toString("base64url");
  const ttl = Math.min(Math.max(input.ttlHours ?? DEFAULT_LINK_TTL_HOURS, 1), 24 * 14);
  const expiresAt = new Date(Date.now() + ttl * 3_600_000).toISOString();

  const { error } = await supabase.from("employee_links").insert({
    token_hash: hashToken(token),
    team_member_id: input.teamMemberId,
    kind: input.kind,
    job_id: input.jobId,
    expires_at: expiresAt,
  });
  if (error) throw error;

  return { url: `${appBaseUrl()}/e/${token}`, expiresAt };
}

export type ResolvedLink =
  | {
      ok: true;
      link: Database["public"]["Tables"]["employee_links"]["Row"];
      memberName: string;
    }
  | { ok: false; reason: "not_found" | "expired" | "revoked" | "inactive" };

/** Look up a link from the URL token and record that it was opened. */
export async function resolveEmployeeLink(supabase: Db, token: string): Promise<ResolvedLink> {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return { ok: false, reason: "not_found" };

  const { data, error } = await supabase
    .from("employee_links")
    .select("*, team_member:team_members(name, active)")
    .eq("token_hash", hashToken(token))
    .maybeSingle();
  if (error) throw error;
  if (!data) return { ok: false, reason: "not_found" };

  const row = data as unknown as Database["public"]["Tables"]["employee_links"]["Row"] & {
    team_member: { name: string; active: boolean } | null;
  };
  if (row.revoked_at) return { ok: false, reason: "revoked" };
  if (new Date(row.expires_at).getTime() < Date.now()) return { ok: false, reason: "expired" };
  if (!row.team_member?.active) return { ok: false, reason: "inactive" };

  const now = new Date().toISOString();
  await supabase
    .from("employee_links")
    .update({ last_opened_at: now, first_opened_at: row.first_opened_at ?? now })
    .eq("id", row.id);

  const { team_member, ...link } = row;
  return { ok: true, link, memberName: team_member.name };
}
