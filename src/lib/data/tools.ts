import { createClient } from "@/lib/supabase/server";
import type { Tool } from "@/types/domain";

export async function listTools(): Promise<Tool[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("tools")
    .select("*")
    .eq("active", true)
    .order("name");

  if (error) throw error;
  return (data ?? []) as unknown as Tool[];
}
