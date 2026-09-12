/**
 * Zones gathered under the service they belong to.
 *
 * A property with six lawn areas produced six separate blocks, each one
 * repeating "Lawn Care" at the top. On a crew sheet that reads as six jobs
 * rather than one job in six places, and the crew loads the truck for six.
 * On a client's proposal it reads as being charged six times for lawn care.
 *
 * Grouped, both say the true thing: one service, these places. The zones keep
 * their own numbers, because a number on a sheet is what somebody points at
 * across a garden, and renumbering them per group would mean the same patch
 * of grass is zone 2 on the crew sheet and zone 5 on the map.
 *
 * The grouping is derived at render rather than stored. Zones are edited, the
 * service on one can change, and a stored grouping is a second copy that goes
 * wrong the first time somebody moves a zone from mowing to mulching.
 */

export interface GroupableZone {
  /** What the service is called, already resolved to a human label. */
  serviceLabel: string;
}

export interface ServiceGroup<T> {
  /** The service every zone in here shares. */
  service: string;
  zones: T[];
  /** The position each zone had in the original list, one-based, so numbering
   * on the sheet matches numbering on the map. */
  positions: number[];
}

/**
 * Group by service, keeping the order the zones were drawn in.
 *
 * A group takes its place in the list from its first zone, so the sheet still
 * runs roughly front-of-property to back rather than being reordered
 * alphabetically into something nobody walked.
 */
export function groupByService<T extends GroupableZone>(zones: T[]): ServiceGroup<T>[] {
  const groups: ServiceGroup<T>[] = [];
  const byService = new Map<string, ServiceGroup<T>>();

  zones.forEach((zone, index) => {
    // Trimmed and case-folded for the lookup only. "Lawn care" and "Lawn
    // Care" are one service; the label shown is whichever spelling came
    // first, rather than a normalised one nobody typed.
    const key = zone.serviceLabel.trim().toLowerCase();
    const existing = byService.get(key);

    if (existing) {
      existing.zones.push(zone);
      existing.positions.push(index + 1);
      return;
    }

    const made: ServiceGroup<T> = {
      service: zone.serviceLabel.trim() || "Other work",
      zones: [zone],
      positions: [index + 1],
    };
    byService.set(key, made);
    groups.push(made);
  });

  return groups;
}

/**
 * How a group is introduced.
 *
 * Says how many places, because that is the fact the grouping exists to
 * carry: one service, six areas. A group of one gets no count -- "Lawn Care,
 * 1 area" is a sentence about nothing.
 */
export function groupHeading(group: ServiceGroup<unknown>): string {
  if (group.zones.length === 1) return group.service;
  return `${group.service} · ${group.zones.length} areas`;
}

/** Whether grouping changes anything. One zone per service means the grouped
 * view and the flat view are the same list, and the extra heading is noise. */
export function worthGrouping(groups: ServiceGroup<unknown>[]): boolean {
  return groups.some((group) => group.zones.length > 1);
}
