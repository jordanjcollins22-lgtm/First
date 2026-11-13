"use server";

import { revalidatePath } from "next/cache";

import { sendDraft } from "@/lib/agent/agent";
import { createClient } from "@/lib/supabase/server";

export interface ActionResult {
  error?: string;
}

export async function approveDraft(formData: FormData): Promise<ActionResult> {
  const supabase = await createClient();
  const id = String(formData.get("id") ?? "");
  const body = String(formData.get("body") ?? "").trim();
  if (!body) return { error: "The reply can't be empty." };

  const { data: draft, error } = await supabase
    .from("agent_drafts")
    .select("*")
    .eq("id", id)
    .eq("status", "pending")
    .maybeSingle();
  if (error) throw error;
  if (!draft) return { error: "That draft was already handled." };

  const result = await sendDraft(supabase, draft, body);
  revalidatePath("/inbox");
  return result.ok ? {} : { error: result.error };
}

export async function discardDraft(formData: FormData): Promise<ActionResult> {
  const supabase = await createClient();
  const id = String(formData.get("id") ?? "");
  const { error } = await supabase
    .from("agent_drafts")
    .update({ status: "discarded", decided_at: new Date().toISOString() })
    .eq("id", id)
    .eq("status", "pending");
  if (error) throw error;
  revalidatePath("/inbox");
  return {};
}
