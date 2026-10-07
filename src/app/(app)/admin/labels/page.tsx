import { redirect } from "next/navigation";
import { headers } from "next/headers";

import { isSupabaseConfigured } from "@/lib/env";
import { checkTabAccess } from "@/lib/data/access";
import { listTools } from "@/lib/data/tools";
import { listMaterials, listMarketingMaterials } from "@/lib/data/materials";
import { listInventoryCodes } from "@/lib/data/inventory-tracking";
import { scanPath } from "@/lib/inventory-codes";
import { qrSvg } from "@/lib/qr";
import { SetupRequiredNotice } from "@/components/setup-required-notice";
import { LabelSheet, type LabelItem, type PlaceLabel } from "@/components/inventory/label-sheet";

export default async function LabelsPage() {
  if (!isSupabaseConfigured) return <SetupRequiredNotice />;

  const { allowed } = await checkTabAccess("labels");
  if (!allowed) redirect("/admin/tools");

  const [tools, materials, marketing, codes, headerList] = await Promise.all([
    listTools().catch(() => []),
    listMaterials().catch(() => []),
    listMarketingMaterials().catch(() => []),
    listInventoryCodes().catch(() => []),
    headers(),
  ]);

  // A QR has to hold a whole address — a phone camera opens a link, it does
  // not know what a bare code means.
  const host = headerList.get("host") ?? "localhost:3000";
  const protocol = host.startsWith("localhost") ? "http" : "https";
  const origin = `${protocol}://${host}`;

  const codeByTool = new Map(codes.filter((c) => c.toolId).map((c) => [c.toolId!, c.code]));
  const codeByMaterial = new Map(
    codes.filter((c) => c.materialId).map((c) => [c.materialId!, c.code])
  );

  const rows: Omit<LabelItem, "qr">[] = [
    ...tools.map((tool) => ({
      id: tool.id,
      name: tool.name,
      kind: "tool" as const,
      code: codeByTool.get(tool.id) ?? null,
      onHand: tool.quantity != null ? Number(tool.quantity) : null,
      unit: "each",
    })),
    ...[...materials, ...marketing].map((material) => ({
      id: material.id,
      name: material.name,
      kind: "material" as const,
      code: codeByMaterial.get(material.id) ?? null,
      onHand:
        material.quantity_on_hand != null ? Number(material.quantity_on_hand) : null,
      unit: material.unit ?? "each",
    })),
  ];

  const items: LabelItem[] = await Promise.all(
    rows.map(async (row) => ({
      ...row,
      qr: row.code ? await qrSvg(`${origin}${scanPath(row.code)}`) : null,
    }))
  );

  const places: PlaceLabel[] = await Promise.all(
    codes
      .filter((code) => code.storageLocation && !code.toolId && !code.materialId)
      .map(async (code) => ({
        id: code.id,
        code: code.code,
        label: code.label ?? code.storageLocation!,
        expectedQuantity: code.expectedQuantity,
        qr: await qrSvg(`${origin}${scanPath(code.code)}`),
      }))
  );

  return <LabelSheet items={items} places={places} />;
}
