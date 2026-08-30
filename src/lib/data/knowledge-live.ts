import { createClient } from "@/lib/supabase/server";
import { EMPTY_ROWS, buildLiveGraph, type LiveRows } from "@/lib/knowledge-live";
import type { GraphEdge, GraphNode } from "@/lib/knowledge-graph";

/**
 * The business, read once, as the graph needs it.
 *
 * Every table is optional. A migration that has not run, a table this
 * deployment does not have, a permission the viewer lacks — any of those costs
 * the part of the picture it came from and nothing else. A graph missing its
 * invoices is still a graph; a graph that refuses to load is not.
 */
export async function loadLiveRows(): Promise<LiveRows> {
  const supabase = await createClient();

  const get = async <T>(run: () => PromiseLike<{ data: unknown }>): Promise<T[]> => {
    try {
      const { data } = await run();
      return (data ?? []) as T[];
    } catch {
      return [];
    }
  };

  const [
    customers,
    properties,
    jobs,
    jobServices,
    services,
    materials,
    tools,
    serviceMaterials,
    serviceTools,
    people,
    jobCrew,
    invoices,
    ledger,
  ] = await Promise.all([
    get<LiveRows["customers"][number]>(() =>
      supabase.from("customers").select("id, name, contact_type")
    ),
    get<LiveRows["properties"][number]>(() =>
      supabase.from("properties").select("id, customer_id, address")
    ),
    get<LiveRows["jobs"][number]>(() =>
      supabase.from("jobs").select("id, name, status, property_id, job_number")
    ),
    get<LiveRows["jobServices"][number]>(() =>
      supabase.from("job_requested_services").select("job_id, service_type_id")
    ),
    get<LiveRows["services"][number]>(() =>
      supabase.from("services").select("service_type_id, name, cost, cost_unit")
    ),
    get<LiveRows["materials"][number]>(() =>
      supabase.from("materials").select("id, name, unit, cost_per_unit, category").eq("active", true)
    ),
    get<LiveRows["tools"][number]>(() =>
      supabase.from("tools").select("id, name, category, cost").eq("active", true)
    ),
    get<LiveRows["serviceMaterials"][number]>(() =>
      supabase.from("service_materials").select("service_type_id, material_id")
    ),
    get<LiveRows["serviceTools"][number]>(() =>
      supabase.from("service_tools").select("service_type_id, tool_id")
    ),
    get<{ id: string; full_name: string | null; email: string }>(() =>
      supabase.from("profiles").select("id, full_name, email")
    ),
    get<LiveRows["jobCrew"][number]>(() => supabase.from("job_crew").select("job_id, profile_id")),
    get<LiveRows["invoices"][number]>(() =>
      supabase.from("invoices").select("id, job_id, amount, status")
    ),
    get<{ category: string; amount: number; job_id: string | null; direction: string }>(() =>
      supabase.from("ledger_entries").select("category, amount, job_id, direction").eq("direction", "out")
    ),
  ]);

  // Grouped here rather than in the pure module: one node per category is the
  // thing anybody would act on, and four hundred fuel receipts on a board is
  // a board nobody can read.
  const byCategory = new Map<string, { total: number; jobIds: Set<string> }>();
  for (const entry of ledger) {
    const key = (entry.category ?? "other").trim() || "other";
    const bucket = byCategory.get(key) ?? { total: 0, jobIds: new Set<string>() };
    bucket.total += Number(entry.amount) || 0;
    if (entry.job_id) bucket.jobIds.add(entry.job_id);
    byCategory.set(key, bucket);
  }

  return {
    ...EMPTY_ROWS,
    customers,
    properties,
    jobs,
    jobServices,
    services,
    materials,
    tools,
    serviceMaterials,
    serviceTools,
    people: people.map((p) => ({ id: p.id, name: p.full_name || p.email })),
    jobCrew,
    invoices: invoices.map((i) => ({ ...i, amount: Number(i.amount) || 0 })),
    spending: [...byCategory.entries()].map(([category, bucket]) => ({
      category,
      total: bucket.total,
      jobIds: [...bucket.jobIds],
    })),
  };
}

/** The business as a graph, or an empty one if none of it could be read. */
export async function getLiveGraph(): Promise<{ nodes: GraphNode[]; edges: GraphEdge[] }> {
  try {
    return buildLiveGraph(await loadLiveRows());
  } catch {
    return { nodes: [], edges: [] };
  }
}
