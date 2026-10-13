import type { SupabaseClient } from "@supabase/supabase-js";

import { isTaskStatus, sortTasks, type TaskRow } from "@/lib/owner-tasks";

/** The business's task list, in page order. Empty (not an error) before the table exists. */
export async function listOwnerTasks(client: unknown, organizationId: string): Promise<TaskRow[]> {
  const { data, error } = await (client as SupabaseClient)
    .from("owner_tasks")
    .select("id, section, title, note, status, position, done_at, updated_at")
    .eq("organization_id", organizationId)
    .limit(500);
  if (error) return [];
  type Row = { id: string; section: string; title: string; note: string | null; status: string; position: number; done_at: string | null; updated_at: string };
  return sortTasks(
    ((data ?? []) as Row[]).map((r) => ({
      id: r.id,
      section: r.section,
      title: r.title,
      note: r.note,
      status: isTaskStatus(r.status) ? r.status : "todo",
      position: r.position,
      doneAt: r.done_at,
      updatedAt: r.updated_at,
    }))
  );
}
