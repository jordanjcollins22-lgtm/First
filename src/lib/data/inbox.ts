import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/database.types";

type Tables = Database["public"]["Tables"];
export type Draft = Tables["agent_drafts"]["Row"];
export type AgentRun = Tables["agent_runs"]["Row"] & {
  team_member: { name: string } | null;
  messages: Pick<Tables["comm_messages"]["Row"], "direction" | "body" | "contact_name" | "contact_address">[];
};

export async function listPendingDrafts(): Promise<Draft[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("agent_drafts")
    .select("*")
    .eq("status", "pending")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function listRecentRuns(limit = 50): Promise<AgentRun[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("agent_runs")
    .select("*, team_member:team_members(name), messages:comm_messages(direction, body, contact_name, contact_address)")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as unknown as AgentRun[];
}
