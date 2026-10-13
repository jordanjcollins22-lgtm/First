"use server";

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/server";
import { getRealProfile } from "@/lib/data/team";
import { isOwnerLevel } from "@/lib/roles";
import { isAccountManager } from "@/lib/affiliate-roles";
import { isTaskSection, isTaskStatus, type TaskStatus } from "@/lib/owner-tasks";

/**
 * Changes to the shared task list. Owners and account managers can add,
 * tick and move tasks; every change is written to owner_task_events so the
 * list says who did what, not just where it ended up.
 */

export type TaskResult = { ok: true; message: string; id?: string } | { ok: false; message: string };

async function editor(): Promise<{ profileId: string; organizationId: string } | string> {
  const profile = await getRealProfile();
  if (!profile) return "Sign in first.";
  if (!isOwnerLevel(profile.roles) && !isAccountManager(profile.roles)) return "Only an owner or account manager can change the task list.";
  return { profileId: profile.id, organizationId: profile.organization_id };
}

async function db(): Promise<SupabaseClient> {
  // The new tables are not in database.types.ts yet. Read and written as
  // the signed-in person, so the table's org policy applies too.
  return (await createClient()) as unknown as SupabaseClient;
}

async function logEvent(client: SupabaseClient, e: { organizationId: string; taskId: string; action: string; from?: string | null; to?: string | null; by: string }) {
  await client.from("owner_task_events").insert({
    organization_id: e.organizationId,
    task_id: e.taskId,
    action: e.action,
    from_value: e.from ?? null,
    to_value: e.to ?? null,
    by_profile: e.by,
  });
}

function refresh() {
  revalidatePath("/v2");
}

export async function addOwnerTask(input: { title: string; section?: string; note?: string }): Promise<TaskResult> {
  const who = await editor();
  if (typeof who === "string") return { ok: false, message: who };
  const title = input.title.trim().slice(0, 200);
  if (!title) return { ok: false, message: "Give the task a name." };
  const section = input.section && isTaskSection(input.section) ? input.section : "Other";
  const client = await db();
  const { data: last } = await client
    .from("owner_tasks")
    .select("position")
    .eq("organization_id", who.organizationId)
    .eq("section", section)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();
  const { data, error } = await client
    .from("owner_tasks")
    .insert({
      organization_id: who.organizationId,
      section,
      title,
      note: input.note?.trim() || null,
      status: "todo",
      position: ((last as { position?: number } | null)?.position ?? 0) + 1,
      created_by: who.profileId,
      updated_by: who.profileId,
    })
    .select("id")
    .single();
  if (error || !data) {
    return { ok: false, message: error?.code === "23505" ? "There is already a task with that name here." : "Couldn't add that. Try again." };
  }
  const id = (data as { id: string }).id;
  await logEvent(client, { organizationId: who.organizationId, taskId: id, action: "added", to: title, by: who.profileId });
  refresh();
  return { ok: true, message: "Added.", id };
}

export async function setOwnerTaskStatus(id: string, status: string): Promise<TaskResult> {
  const who = await editor();
  if (typeof who === "string") return { ok: false, message: who };
  if (!isTaskStatus(status)) return { ok: false, message: "Unknown status." };
  const client = await db();
  const { data: row } = await client.from("owner_tasks").select("status").eq("id", id).eq("organization_id", who.organizationId).maybeSingle();
  if (!row) return { ok: false, message: "Couldn't find that task." };
  const from = (row as { status: TaskStatus }).status;
  if (from === status) return { ok: true, message: "No change." };
  const now = new Date().toISOString();
  const { error } = await client
    .from("owner_tasks")
    .update({
      status,
      updated_at: now,
      updated_by: who.profileId,
      done_at: status === "done" ? now : null,
      done_by: status === "done" ? who.profileId : null,
    })
    .eq("id", id)
    .eq("organization_id", who.organizationId);
  if (error) return { ok: false, message: "Couldn't save that. Try again." };
  await logEvent(client, { organizationId: who.organizationId, taskId: id, action: "status", from, to: status, by: who.profileId });
  refresh();
  return { ok: true, message: "Saved." };
}

export async function editOwnerTask(id: string, input: { title?: string; note?: string }): Promise<TaskResult> {
  const who = await editor();
  if (typeof who === "string") return { ok: false, message: who };
  const patch: Record<string, string | null> = {};
  if (input.title !== undefined) {
    const title = input.title.trim().slice(0, 200);
    if (!title) return { ok: false, message: "A task needs a name." };
    patch.title = title;
  }
  if (input.note !== undefined) patch.note = input.note.trim() || null;
  if (Object.keys(patch).length === 0) return { ok: true, message: "No change." };
  const client = await db();
  const { error } = await client
    .from("owner_tasks")
    .update({ ...patch, updated_at: new Date().toISOString(), updated_by: who.profileId })
    .eq("id", id)
    .eq("organization_id", who.organizationId);
  if (error) return { ok: false, message: error.code === "23505" ? "There is already a task with that name here." : "Couldn't save that. Try again." };
  await logEvent(client, { organizationId: who.organizationId, taskId: id, action: "edited", to: patch.title ?? patch.note ?? null, by: who.profileId });
  refresh();
  return { ok: true, message: "Saved." };
}
