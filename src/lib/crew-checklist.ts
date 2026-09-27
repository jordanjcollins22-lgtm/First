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

export interface CrewChecklist {
  tools: string[];
  materials: ChecklistMaterial[];
  areas: ChecklistArea[];
}

export function buildCrewChecklist(input: {
  zones: { id: string; name: string; serviceTypeId: string; serviceName: string }[];
  serviceTools: { service_type_id: string; tool_id: string }[];
  tools: { id: string; name: string }[];
  materials: { material: string; unit: string; quantity: number; manual?: boolean }[];
  /** Zone ids that have an after photo. */
  finishedZoneIds: Set<string>;
}): CrewChecklist {
  const services = new Set(input.zones.map((z) => z.serviceTypeId));
  const toolName = new Map(input.tools.map((t) => [t.id, t.name]));
  const tools = [
    ...new Set(
      input.serviceTools
        .filter((link) => services.has(link.service_type_id))
        .map((link) => toolName.get(link.tool_id))
        .filter((name): name is string => Boolean(name))
    ),
  ].sort((a, b) => a.localeCompare(b));

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
  return { tools, materials, areas };
}
