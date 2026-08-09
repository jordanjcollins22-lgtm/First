import { listTools } from "@/lib/data/tools";
import { isSupabaseConfigured } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { SERVICE_TYPES } from "@/components/canvas/service-catalog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SetupRequiredNotice } from "@/components/setup-required-notice";
import { CreateToolForm } from "@/components/tool/create-tool-form";
import { ToolCostInput } from "@/components/tool/tool-cost-input";
import { ToolServiceToggles } from "@/components/tool/tool-service-toggles";
import { DeactivateToolButton } from "@/components/tool/deactivate-tool-button";

export default async function ToolsPage() {
  if (!isSupabaseConfigured) return <SetupRequiredNotice />;

  const supabase = await createClient();
  const [tools, linksRes] = await Promise.all([
    listTools(),
    supabase.from("service_tools").select("*"),
  ]);

  const linksByTool = new Map<string, string[]>();
  for (const link of linksRes.data ?? []) {
    const arr = linksByTool.get(link.tool_id) ?? [];
    arr.push(link.service_type_id);
    linksByTool.set(link.tool_id, arr);
  }

  const serviceTypeOptions = SERVICE_TYPES.map((t) => ({ id: t.id, label: t.label }));

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="mb-1 text-2xl font-bold">Tools</h1>
      <p className="mb-6 text-muted-foreground">
        Your tool inventory and costs. Toggle which services a tool applies to — the
        canvas picks tools for a zone automatically from these, no manual selection
        needed there.
      </p>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Add a tool</CardTitle>
        </CardHeader>
        <CardContent>
          <CreateToolForm />
        </CardContent>
      </Card>

      <div className="flex flex-col gap-3">
        {tools.map((tool) => (
          <Card key={tool.id}>
            <CardContent className="flex flex-col gap-3 pt-6">
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-center gap-2">
                  <span className="text-xl" aria-hidden>
                    {tool.icon}
                  </span>
                  <div>
                    <p className="font-semibold">{tool.name}</p>
                    {tool.is_rental && (
                      <p className="text-xs text-muted-foreground">Rental item</p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <ToolCostInput toolId={tool.id} initialCost={tool.cost} />
                  <DeactivateToolButton id={tool.id} />
                </div>
              </div>
              <ToolServiceToggles
                toolId={tool.id}
                serviceTypes={serviceTypeOptions}
                linkedServiceTypeIds={linksByTool.get(tool.id) ?? []}
              />
            </CardContent>
          </Card>
        ))}
        {tools.length === 0 && (
          <p className="text-sm text-muted-foreground">No tools yet — add one above.</p>
        )}
      </div>
    </div>
  );
}
