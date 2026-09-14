/**
 * The morning load-out.
 *
 * Every visit says what it needs brought: kits, loose tools, materials. A
 * person on three jobs in a day does not want three lists; they want one,
 * with the dolly on it once, ticked off at the shop before the truck moves.
 * This merges a day's visits into that one list and works out how far
 * through it somebody is.
 */

export type LoadoutKind = "kit" | "tool" | "material";

export interface LoadoutSession {
  sessionId: string;
  jobId: string;
  customerName: string;
  address: string;
  kits: number[];
  toolIds: string[];
  materials: string[];
}

export interface LoadoutTool {
  id: string;
  name: string;
  kits: number[];
}

export interface LoadoutContainer {
  name: string;
  kits: number[];
}

export interface LoadoutCheck {
  kind: LoadoutKind;
  key: string;
}

export interface LoadoutItem {
  kind: LoadoutKind;
  /** Stable across days: the kit number, the tool id, the material name. */
  key: string;
  label: string;
  /** What is in a kit, or nothing. */
  detail: string | null;
  /** Which stops want it, by client, so a shared kit reads as shared. */
  forStops: string[];
  checked: boolean;
}

export interface Loadout {
  items: LoadoutItem[];
  total: number;
  done: number;
  complete: boolean;
}

/** Kit keys and material keys are normalised so the same thing spelt twice is one line. */
export function materialKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

function kitDetail(kit: number, tools: readonly LoadoutTool[], containers: readonly LoadoutContainer[]): string | null {
  const names = tools.filter((t) => t.kits.includes(kit)).map((t) => t.name);
  const box = containers.find((c) => c.kits.includes(kit))?.name ?? null;
  const parts = [box ? `In the ${box.toLowerCase()}` : null, names.length > 0 ? names.join(", ") : null].filter(
    Boolean
  ) as string[];
  return parts.length > 0 ? parts.join(". ") : null;
}

function addStop(map: Map<string, Set<string>>, key: string, who: string) {
  const set = map.get(key) ?? new Set<string>();
  set.add(who);
  map.set(key, set);
}

export function buildLoadout(
  sessions: readonly LoadoutSession[],
  tools: readonly LoadoutTool[],
  containers: readonly LoadoutContainer[],
  checks: readonly LoadoutCheck[]
): Loadout {
  const ticked = new Set(checks.map((c) => `${c.kind}:${c.key}`));
  const kitStops = new Map<string, Set<string>>();
  const toolStops = new Map<string, Set<string>>();
  const materialStops = new Map<string, Set<string>>();
  const materialLabels = new Map<string, string>();

  for (const s of sessions) {
    for (const kit of s.kits) addStop(kitStops, String(kit), s.customerName);
    for (const id of s.toolIds) addStop(toolStops, id, s.customerName);
    for (const m of s.materials) {
      const key = materialKey(m);
      if (!key) continue;
      addStop(materialStops, key, s.customerName);
      if (!materialLabels.has(key)) materialLabels.set(key, m.trim());
    }
  }

  const toolName = new Map(tools.map((t) => [t.id, t.name]));

  const items: LoadoutItem[] = [
    ...[...kitStops.keys()]
      .map(Number)
      .sort((a, b) => a - b)
      .map((kit) => ({
        kind: "kit" as const,
        key: String(kit),
        label: `Kit ${kit}`,
        detail: kitDetail(kit, tools, containers),
        forStops: [...kitStops.get(String(kit))!],
        checked: ticked.has(`kit:${kit}`),
      })),
    ...[...toolStops.keys()]
      .map((id) => ({ id, name: toolName.get(id) ?? "A tool no longer on the list" }))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(({ id, name }) => ({
        kind: "tool" as const,
        key: id,
        label: name,
        detail: null,
        forStops: [...toolStops.get(id)!],
        checked: ticked.has(`tool:${id}`),
      })),
    ...[...materialStops.keys()].sort().map((key) => ({
      kind: "material" as const,
      key,
      label: materialLabels.get(key) ?? key,
      detail: null,
      forStops: [...materialStops.get(key)!],
      checked: ticked.has(`material:${key}`),
    })),
  ];

  const done = items.filter((i) => i.checked).length;
  return { items, total: items.length, done, complete: items.length === 0 || done === items.length };
}

/** One visit's list in words, for the visit row on the job page. */
export function bringSummary(
  session: Pick<LoadoutSession, "kits" | "toolIds" | "materials">,
  tools: readonly LoadoutTool[]
): string | null {
  const names = new Map(tools.map((t) => [t.id, t.name]));
  const parts = [
    ...[...session.kits].sort((a, b) => a - b).map((k) => `Kit ${k}`),
    ...session.toolIds.map((id) => names.get(id) ?? "a tool"),
    ...session.materials.map((m) => m.trim()).filter(Boolean),
  ];
  return parts.length > 0 ? parts.join(", ") : null;
}

/** Why the truck cannot leave yet, or null when it can. */
export function leaveBlockedBy(loadout: Loadout): string | null {
  if (loadout.complete) return null;
  const left = loadout.total - loadout.done;
  return left === 1 ? "One thing on the load-out is not ticked yet." : `${left} things on the load-out are not ticked yet.`;
}
