/**
 * Which kits a visit needs, read off the services sold, and whether the
 * morning load-out was ticked in time.
 *
 * Services already list their tools (service_tools), and tools already say
 * which kits they live in (tools.kits). What nobody had joined is the two:
 * every visit's kits were picked by hand on the job page, so a visit nobody
 * opened went out with an empty list and the load-out check passed by having
 * nothing on it. Pure, so the rules are tested without a database.
 */

interface Zoneish {
  serviceTypeId?: string;
  service_type_id?: string;
  service?: { typeId?: string } | null;
  services?: { serviceTypeId?: string; service_type_id?: string }[];
}

/** Every service on a job: what was drawn on the site map, plus what the client asked for. */
export function serviceIdsFrom(zones: unknown, requested: readonly { service_type_id: string }[]): string[] {
  const ids = new Set<string>(requested.map((row) => row.service_type_id));
  for (const zone of (Array.isArray(zones) ? zones : []) as (Zoneish | null)[]) {
    if (!zone || typeof zone !== "object") continue;
    const own = zone.serviceTypeId ?? zone.service_type_id ?? zone.service?.typeId;
    if (own) ids.add(own);
    for (const service of zone.services ?? []) {
      const id = service.serviceTypeId ?? service.service_type_id;
      if (id) ids.add(id);
    }
  }
  return [...ids];
}

export interface KitTool {
  id: string;
  kits: number[];
}

/**
 * The fewest kits that carry every tool the services need, plus any tool that
 * is in no kit at all, to load on its own.
 *
 * A tool in kits 1 and 3 does not mean loading both. The kit that covers the
 * most of what is still uncovered goes first, lowest number on a tie, until
 * nothing is left -- the usual greedy cover, which is exact for the handful
 * of kits a crew has.
 */
export function kitsForServices(
  serviceTypeIds: readonly string[],
  serviceTools: readonly { service_type_id: string; tool_id: string }[],
  tools: readonly KitTool[]
): { kits: number[]; looseToolIds: string[] } {
  const wanted = new Set(serviceTools.filter((r) => serviceTypeIds.includes(r.service_type_id)).map((r) => r.tool_id));
  const toolById = new Map(tools.map((t) => [t.id, t]));
  const loose: string[] = [];
  const uncovered = new Set<string>();
  for (const id of wanted) {
    const tool = toolById.get(id);
    if (!tool) continue;
    if (tool.kits.length === 0) loose.push(id);
    else uncovered.add(id);
  }

  const kitsOf = new Map<number, Set<string>>();
  for (const id of uncovered) {
    for (const kit of toolById.get(id)!.kits) {
      kitsOf.set(kit, (kitsOf.get(kit) ?? new Set()).add(id));
    }
  }

  const chosen: number[] = [];
  while (uncovered.size > 0) {
    let best: number | null = null;
    let bestCount = 0;
    for (const [kit, members] of kitsOf) {
      const count = [...members].filter((id) => uncovered.has(id)).length;
      if (count > bestCount || (count === bestCount && count > 0 && best != null && kit < best)) {
        best = kit;
        bestCount = count;
      }
    }
    if (best == null || bestCount === 0) break;
    chosen.push(best);
    for (const id of kitsOf.get(best)!) uncovered.delete(id);
    kitsOf.delete(best);
  }

  return { kits: chosen.sort((a, b) => a - b), looseToolIds: loose.sort() };
}

/**
 * Whether a crew member's load-out is overdue: the trucks should have gone,
 * there is something on their list, it isn't all ticked, and they haven't
 * left the shop. Somebody meeting the crew on site skips the shop entirely
 * and is never late for it.
 */
export function loadoutOverdue(input: {
  /** Minutes past midnight, business time. */
  nowMinutes: number;
  shopMinutes: number;
  graceMinutes: number;
  itemCount: number;
  complete: boolean;
  leftShop: boolean;
  throughShop: boolean;
}): boolean {
  if (!input.throughShop || input.itemCount === 0 || input.complete || input.leftShop) return false;
  return input.nowMinutes >= input.shopMinutes + input.graceMinutes;
}

/** "07:00:00" as minutes past midnight. Seven o'clock when it can't be read. */
export function minutesOfTime(time: string | null | undefined): number {
  const m = (time ?? "").match(/^(\d{1,2}):(\d{2})/);
  if (!m) return 7 * 60;
  return Number(m[1]) * 60 + Number(m[2]);
}
