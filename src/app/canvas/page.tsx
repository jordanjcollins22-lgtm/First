import { ImageCanvasBoard } from "@/components/canvas/image-canvas-board";
import { getCanvasCatalog, type CanvasCatalog } from "@/lib/data/canvas-catalog";
import { isSupabaseConfigured } from "@/lib/env";

const EMPTY_CATALOG: CanvasCatalog = {
  tools: [],
  materials: [],
  serviceTools: [],
  serviceMaterialRules: [],
  servicePricing: [],
};

export default async function CanvasPage() {
  const catalog = isSupabaseConfigured ? await getCanvasCatalog() : EMPTY_CATALOG;

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6 px-4 py-10">
      <div>
        <h1 className="text-2xl font-bold">Design Canvas</h1>
        <p className="text-muted-foreground">
          Upload a reference photo and lock it in place, then draw work zones and fill in
          the service details to build a scope of work.
        </p>
      </div>

      {!isSupabaseConfigured && (
        <p className="rounded-md border border-border bg-muted px-3 py-2 text-xs text-muted-foreground">
          Supabase isn&apos;t configured, so tools, materials, and pricing aren&apos;t available —
          set it up and add some in <span className="font-medium">Tools</span> /{" "}
          <span className="font-medium">Material Database</span> / <span className="font-medium">Services</span> to
          have them picked automatically per zone.
        </p>
      )}

      <ImageCanvasBoard catalog={catalog} />
    </div>
  );
}
