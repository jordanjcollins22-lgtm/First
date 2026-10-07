import { createAdminClient } from "@/lib/supabase/admin";
import { log } from "@/lib/log";
import { isOwnerLevel } from "@/lib/roles";
import { runningComputers, type FinderComputer } from "@/lib/finder-fleet";

/** A computer id the extension made, or the stand-in for a copy too old to send one. */
export function computerKey(sent: string | null | undefined, profileId: string): string {
  return sent && /^[0-9a-f-]{36}$/i.test(sent) ? sent : `profile:${profileId}`;
}

export interface ComputerRow extends FinderComputer {
  name: string | null;
  version: string | null;
  lastLook: { name?: string; posts?: number; sent?: number } | null;
  lastLookAt: string | null;
}

/**
 * This computer has checked in. Written with the service role: the table is
 * read-only to signed-in people, so nobody can mark a computer running from
 * the browser.
 */
export async function checkIn(input: { id: string; organizationId: string; profileId: string; name: string; version: string | null }, now: Date): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin.from("finder_computers").upsert(
    {
      id: input.id,
      organization_id: input.organizationId,
      profile_id: input.profileId,
      label: input.name.slice(0, 80),
      version: input.version,
      last_seen_at: now.toISOString(),
    },
    { onConflict: "id" }
  );
  if (error) log.warn("finder.check_in_failed", { error: error.message });
}

/** What a computer last looked at, from the posts it just sent. */
export async function noteLook(id: string, organizationId: string, look: unknown, now: Date): Promise<void> {
  const admin = createAdminClient();
  await admin
    .from("finder_computers")
    .update({ last_look: (look ?? null) as never, last_look_at: now.toISOString(), last_seen_at: now.toISOString() })
    .eq("id", id)
    .eq("organization_id", organizationId);
}

/** Every computer the business has seen, newest check-in first. */
export async function listComputers(organizationId: string): Promise<ComputerRow[]> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("finder_computers")
    .select("id, profile_id, label, version, first_seen_at, last_seen_at, last_look, last_look_at")
    .eq("organization_id", organizationId)
    .order("last_seen_at", { ascending: false })
    .limit(50);
  return (data ?? []).map((r) => ({
    id: r.id,
    profileId: r.profile_id,
    name: r.label,
    version: r.version,
    firstSeenAt: r.first_seen_at,
    lastSeenAt: r.last_seen_at,
    lastLook: (r.last_look as ComputerRow["lastLook"]) ?? null,
    lastLookAt: r.last_look_at,
  }));
}

/** The computers running now, and which of their people are owners, for sharing the work out. */
export async function runningWithOwners(organizationId: string, now: Date): Promise<{ running: ComputerRow[]; owners: Set<string> }> {
  const running = runningComputers(await listComputers(organizationId), now);
  const profileIds = [...new Set(running.map((c) => c.profileId).filter((id): id is string => Boolean(id)))];
  const owners = new Set<string>();
  if (profileIds.length > 0) {
    const { data } = await createAdminClient().from("profile_roles").select("profile_id, role_name").in("profile_id", profileIds);
    const roles = new Map<string, string[]>();
    for (const r of data ?? []) roles.set(r.profile_id, [...(roles.get(r.profile_id) ?? []), r.role_name]);
    for (const [id, list] of roles) if (isOwnerLevel(list)) owners.add(id);
  }
  return { running, owners };
}
