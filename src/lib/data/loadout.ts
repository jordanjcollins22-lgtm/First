import { createClient } from "@/lib/supabase/server";
import { buildLoadout, type Loadout, type LoadoutCheck, type LoadoutSession, type LoadoutTool } from "@/lib/loadout";

/**
 * One person's load-out for one day: every visit they are crew on that
 * covers the day, added up, against what they have ticked so far.
 */
export async function getLoadout(profileId: string, day: string): Promise<Loadout> {
  const supabase = await createClient();

  const { data: rosterRows } = await supabase.from("job_crew").select("job_id").eq("profile_id", profileId);
  const myJobs = ((rosterRows ?? []) as { job_id: string }[]).map((r) => r.job_id);
  if (myJobs.length === 0) return buildLoadout([], [], [], []);

  const [{ data: sessionRows }, { data: toolRows }, { data: containerRows }, { data: checkRows }] = await Promise.all([
    supabase
      .from("job_work_sessions")
      .select("id, job_id, kits, tool_ids, materials, jobs(status, properties(address, customers(name)))")
      .in("job_id", myJobs)
      .lte("starts_on", day)
      .gte("ends_on", day)
      .not("status", "in", "(cancelled,done)"),
    // Every tool, not only the active ones: a visit that names a tool
      // somebody has since retired should still say which tool it meant.
      supabase.from("tools").select("id, name, kits, active"),
    supabase.from("kit_containers").select("name, kits").is("archived_at", null),
    supabase.from("loadout_checks").select("item_kind, item_key").eq("profile_id", profileId).eq("day", day),
  ]);

  type Row = {
    id: string;
    job_id: string;
    kits: number[] | null;
    tool_ids: string[] | null;
    materials: string[] | null;
    jobs: { status: string; properties: { address: string; customers: { name: string } | null } | null } | null;
  };

  const sessions: LoadoutSession[] = ((sessionRows ?? []) as unknown as Row[])
    .filter((r) => r.jobs?.status !== "cancelled" && r.jobs?.status !== "completed")
    .map((r) => ({
      sessionId: r.id,
      jobId: r.job_id,
      customerName: r.jobs?.properties?.customers?.name ?? "Client",
      address: r.jobs?.properties?.address ?? "Address missing",
      kits: r.kits ?? [],
      toolIds: r.tool_ids ?? [],
      materials: r.materials ?? [],
    }));

  const tools: LoadoutTool[] = (
    (toolRows ?? []) as { id: string; name: string; kits: number[] | null; active: boolean }[]
  ).map((t) => ({
    id: t.id,
    name: t.active ? t.name : `${t.name} (marked inactive in inventory)`,
    // A retired tool is out of its kits; the visit that names it still gets it.
    kits: t.active ? (t.kits ?? []) : [],
  }));
  const containers = ((containerRows ?? []) as { name: string; kits: number[] | null }[]).map((c) => ({
    name: c.name,
    kits: c.kits ?? [],
  }));
  const checks = ((checkRows ?? []) as { item_kind: string; item_key: string }[]).map<LoadoutCheck>((c) => ({
    kind: c.item_kind as LoadoutCheck["kind"],
    key: c.item_key,
  }));

  return buildLoadout(sessions, tools, containers, checks);
}
