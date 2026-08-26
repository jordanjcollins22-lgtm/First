import { isSupabaseConfigured } from "@/lib/env";
import { requireTab } from "@/lib/data/access";
import { getCurrentProfile } from "@/lib/data/team";
import { getKnowledgeGraph, type KnowledgeGraphData } from "@/lib/data/knowledge-graph";
import { SetupRequiredNotice } from "@/components/setup-required-notice";
import { KnowledgeWorkspace } from "@/components/knowledge/knowledge-workspace";
import { todayKey } from "@/lib/knowledge-schedule";

/**
 * Where ideas get broken down until they stop being ideas.
 *
 * Not another CRM screen: nothing here is a record of something that happened,
 * and nothing has a due date. It exists so that seven marketing plans can be
 * seen to be one printer, which is a thing a list of seven marketing plans can
 * never show you.
 */
export default async function KnowledgeGraphPage() {
  if (!isSupabaseConfigured) return <SetupRequiredNotice />;
  await requireTab("knowledge-graph", "/dashboard");

  const profile = await getCurrentProfile();

  let data: KnowledgeGraphData | null = null;
  try {
    data = await getKnowledgeGraph();
  } catch (err) {
    console.error("Knowledge graph failed to load:", err);
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:py-8">
      <h1 className="text-2xl font-bold">Knowledge Graph</h1>
      <p className="mb-4 text-muted-foreground">
        Put the thought down, then break it into what it actually needs. Give it a date and it comes
        round on its own — and anything two scheduled ideas both need surfaces as one job instead of two.
      </p>

      {!data ? (
        <p className="rounded-xl border border-white/60 bg-card/60 p-4 text-sm text-muted-foreground backdrop-blur-md">
          Couldn&apos;t load the graph right now. Reload the page and try again.
        </p>
      ) : data.setupNeeded ? (
        <p className="rounded-xl border border-amber-400/60 bg-amber-50/60 p-4 text-sm">
          This needs its database migration. In Supabase&apos;s SQL Editor, run{" "}
          <code>supabase/migrations/0093_knowledge_graph.sql</code> — or open{" "}
          <a href="/admin/database" className="underline">
            Database setup
          </a>{" "}
          to copy it — then reload.
        </p>
      ) : (
        <KnowledgeWorkspace
          graph={{ nodes: data.nodes, edges: data.edges }}
          tags={data.tags}
          canDelete={profile?.roles.includes("admin") ?? false}
          today={todayKey()}
        />
      )}
    </div>
  );
}
