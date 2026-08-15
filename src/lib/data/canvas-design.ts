import { createClient } from "@/lib/supabase/server";
import type { CanvasDesignRow } from "@/types/domain";

export async function getCanvasDesignForJob(jobId: string): Promise<CanvasDesignRow | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("canvas_designs")
    .select("*")
    .eq("job_id", jobId)
    .maybeSingle();
  if (error) throw error;
  return (data as unknown as CanvasDesignRow) ?? null;
}
