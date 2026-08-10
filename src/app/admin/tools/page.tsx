import { listTools } from "@/lib/data/tools";
import { isSupabaseConfigured } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { SERVICE_TYPES } from "@/components/canvas/service-catalog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SetupRequiredNotice } from "@/components/setup-required-notice";
import { CreateToolForm } from "@/components/tool/create-tool-form";
import { ToolInventoryRow } from "@/components/tool/tool-inventory-row";

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
  const outOfStockCount = tools.filter((t) => t.quantity === 0).length;

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <h1 className="mb-1 text-2xl font-bold">Tool Database</h1>
      <p className="mb-6 text-muted-foreground">
        Your tool inventory — stock on hand, cost, kits, and which services each tool
        applies to.
      </p>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Add a tool</CardTitle>
        </CardHeader>
        <CardContent>
          <CreateToolForm />
        </CardContent>
      </Card>

      <div className="mb-3 flex items-center gap-4 text-sm text-muted-foreground">
        <span>{tools.length} tools</span>
        {outOfStockCount > 0 && (
          <span className="font-medium text-destructive">{outOfStockCount} out of stock</span>
        )}
      </div>

      <Card>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="p-2 font-medium">Tool</th>
                <th className="p-2 font-medium">Kit(s)</th>
                <th className="p-2 font-medium">Qty</th>
                <th className="p-2 font-medium">Cost</th>
                <th className="p-2 font-medium">Status</th>
                <th className="p-2" />
              </tr>
            </thead>
            <tbody>
              {tools.map((tool) => (
                <ToolInventoryRow
                  key={tool.id}
                  tool={tool}
                  serviceTypes={serviceTypeOptions}
                  linkedServiceTypeIds={linksByTool.get(tool.id) ?? []}
                />
              ))}
            </tbody>
          </table>
        </div>
        {tools.length === 0 && (
          <p className="p-4 text-sm text-muted-foreground">No tools yet — add one above.</p>
        )}
      </Card>
    </div>
  );
}
