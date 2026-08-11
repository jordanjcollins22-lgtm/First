"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";

export async function assignJob(jobId: string, profileId: string | null) {
  const supabase = await createClient();
  const { error } = await supabase.from("jobs").update({ assigned_to: profileId }).eq("id", jobId);
  if (error) throw error;
  revalidatePath("/attractors");
}
