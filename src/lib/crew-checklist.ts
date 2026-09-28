/**
 * The checklist at the top of the crew sheet.
 *
 * What goes on the truck, from the tools each service takes and the
 * materials the areas need, added up across the job. Then the work, one line
 * per area, ticked off when that area has its after photo: the photo is the
 * proof the area is finished, so it is also the tick.
 *
 * Pure, so the adding up is tested without a database.
 */

export interface ChecklistMaterial {
  name: string;
  /** "3.5 cubic yards", or "As needed" when nobody could work out an amount. */
  amount: string;
}

export interface ChecklistArea {
  id: string;
  name: string;
  service: string;
  done: boolean;
}

export interface ChecklistKit {
  kit: number;
  /** Everything packed in it, so they can see it's all there. */
  contents: string[];
  photoUrl: string | null;
}

export interface CrewChecklist {
  /** The kits to grab: the fewest, lowest-numbered kits holding every kitted tool the job needs. */
  kits: ChecklistKit[];
  /** The tools the job needs that aren't in any kit. */
  tools: string[];
  materials: ChecklistMaterial[];
  areas: ChecklistArea[];
}

export function buildCrewChecklist(input: {
  zones: { id: string; name: string; serviceTypeId: string; serviceName: string }[];
  serviceTools: { service_type_id: string; tool_id: string }[];
  /** kits: the kits each tool is packed in. Left out, every tool travels loose. */
  tools: { id: string; name: string; kits?: number[] | null }[];
  materials: { material: string; unit: string; quantity: number; manual?: boolean }[];
  /** Zone ids that have an after photo. */
  finishedZoneIds: Set<string>;
  /** Each kit's photo, by kit number. */
  kitPhotos?: Readonly<Record<number, string>>;
}): CrewChecklist {
  const services = new Set(input.zones.map((z) => z.serviceTypeId));
  const byId = new Map(input.tools.map((t) => [t.id, t]));
  const needed = [
    ...new Map(
      input.serviceTools
        .filter((link) => services.has(link.service_type_id))
        .map((link) => byId.get(link.tool_id))
        .filter((tool): tool is (typeof input.tools)[number] => Boolean(tool))
        .map((tool) => [tool.id, tool])
    ).values(),
  ];

  // A tool in a kit comes with the kit. The kits holding the most of what's
  // needed go first, so the crew grabs as few as it can.
  const kitted = needed.filter((t) => (t.kits ?? []).length > 0);
  const chosen: number[] = [];
  let uncovered = kitted;
  while (uncovered.length > 0) {
    const counts = new Map<number, number>();
    for (const tool of uncovered) for (const k of tool.kits ?? []) counts.set(k, (counts.get(k) ?? 0) + 1);
    const [best] = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0];
    chosen.push(best);
    uncovered = uncovered.filter((t) => !(t.kits ?? []).includes(best));
  }
  const kits = chosen
    .sort((a, b) => a - b)
    .map((kit) => ({
      kit,
      contents: [...new Set(input.tools.filter((t) => (t.kits ?? []).includes(kit)).map((t) => t.name))].sort((a, b) => a.localeCompare(b)),
      photoUrl: input.kitPhotos?.[kit] ?? null,
    }));
  const tools = [...new Set(needed.filter((t) => (t.kits ?? []).length === 0).map((t) => t.name))].sort((a, b) => a.localeCompare(b));

  const totals = new Map<string, { name: string; unit: string; quantity: number; manual: boolean }>();
  for (const item of input.materials) {
    const key = `${item.material}|${item.unit}`;
    const current = totals.get(key) ?? { name: item.material, unit: item.unit, quantity: 0, manual: false };
    if (item.manual) current.manual = true;
    else current.quantity += item.quantity;
    totals.set(key, current);
  }
  const materials = [...totals.values()].map((m) => ({
    name: m.name,
    amount: m.quantity > 0 ? `${m.quantity < 10 ? m.quantity.toFixed(1) : Math.round(m.quantity).toLocaleString()} ${m.unit}` : "As needed",
  }));

  const areas = input.zones.map((z) => ({ id: z.id, name: z.name, service: z.serviceName, done: input.finishedZoneIds.has(z.id) }));
  return { kits, tools, materials, areas };
}
