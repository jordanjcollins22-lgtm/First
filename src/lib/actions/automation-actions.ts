"use server";

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentProfile } from "@/lib/data/team";
import { getCurrentOrganizationId } from "@/lib/data/organizations";
import { isOwnerLevel } from "@/lib/roles";

/**
 * Closing a task the backbone opened. Through the person's own row
 * security, and with their name on it, so the audit says who decided.
 */
export async function resolveWorkflowTask(formData: FormData): Promise<void> {
  const profile = await getCurrentProfile();
  if (!profile) throw new Error("Not signed in.");
  const id = String(formData.get("id") ?? "");
  const resolution = String(formData.get("resolution") ?? "").trim() || "Dealt with.";
  const supabase = (await createClient()) as unknown as SupabaseClient;
  const { error } = await supabase
    .from("workflow_tasks")
    .update({ state: "done", resolved_at: new Date().toISOString(), resolved_by: profile.id, resolution })
    .eq("id", id)
    .eq("state", "open");
  if (error) throw error;
  revalidatePath("/automation");
}

/**
 * The owner's switch: record events, keep everything on paper, or hold it
 * all still. Owner only, and stamped with who changed it.
 */
export async function setAutomationControls(formData: FormData): Promise<void> {
  const profile = await getCurrentProfile();
  if (!profile || !isOwnerLevel(profile.roles)) throw new Error("Only an owner can change the automation switch.");
  const organizationId = await getCurrentOrganizationId();
  const flag = (name: string) => formData.get(name) === "on";
  const admin = createAdminClient() as unknown as SupabaseClient;
  const { error } = await admin.from("automation_controls").upsert(
    {
      organization_id: organizationId,
      events_enabled: flag("events_enabled"),
      // Leaving dry run is the one change that matters most, so it is the
      // one that has to be asked for explicitly: an unticked box keeps it on.
      dry_run: formData.get("live") !== "on",
      paused: flag("paused"),
      paused_reason: flag("paused") ? String(formData.get("paused_reason") ?? "").trim() || null : null,
      updated_at: new Date().toISOString(),
      updated_by: profile.id,
    },
    { onConflict: "organization_id" }
  );
  if (error) throw error;
  revalidatePath("/automation");
}
