/**
 * Sharing the looking out between computers.
 *
 * Every computer running the finder scrolls its own Facebook account's home
 * feed and groups feed: those are different for every account, so each one
 * reads all of its own. The saved searches and the listed groups look the
 * same from any account, so with two or more computers running at once they
 * are dealt out between them, one each in turn, instead of every computer
 * doing every search. Only one computer reads the business's review pages.
 *
 * Which computers are running is read from when each last checked in. The
 * order is when each first appeared, so the deal is the same on every check
 * while the same computers are on. Pure, so the deal is tested.
 */

/** A computer that has not checked in for this long is not running. */
export const RUNNING_WITHIN_MS = 3 * 60_000;

export interface FinderComputer {
  id: string;
  profileId: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
}

/** The computers running now, oldest first. */
export function runningComputers<T extends FinderComputer>(rows: T[], now: Date): T[] {
  return rows
    .filter((r) => now.getTime() - new Date(r.lastSeenAt).getTime() < RUNNING_WITHIN_MS)
    .sort((a, b) => a.firstSeenAt.localeCompare(b.firstSeenAt) || a.id.localeCompare(b.id));
}

export interface ShareableSettings {
  groups: { url: string; name?: string | null }[];
  searchPhrases: string[];
  searches: { phrase: string; url: string }[];
  sources: { feed?: boolean; search?: boolean; list?: boolean };
}

/**
 * This computer's share of what there is to look at.
 *
 * Its place among the running computers decides it: with three running, the
 * second takes the second search, the fifth, the eighth, and so on. The
 * groups feed stays with every computer. A computer not yet on the list is
 * counted as joining at the end.
 */
export function shareFor<T extends ShareableSettings>(
  settings: T,
  running: { id: string }[],
  me: string,
  groupsFeedUrl: string
): T & { share: { place: number; of: number } } {
  const ids = running.map((c) => c.id);
  if (!ids.includes(me)) ids.push(me);
  const of = ids.length;
  const place = ids.indexOf(me);
  const mine = <X>(list: X[]) => (of <= 1 ? list : list.filter((_, i) => i % of === place));

  const feed = settings.groups.filter((g) => g.url === groupsFeedUrl);
  const listed = settings.groups.filter((g) => g.url !== groupsFeedUrl);
  const groups = [...feed, ...mine(listed)];
  const searches = mine(settings.searches);
  return {
    ...settings,
    groups,
    searches,
    searchPhrases: searches.map((s) => s.phrase),
    sources: { ...settings.sources, list: groups.length > 0 },
    share: { place: place + 1, of },
  };
}

/**
 * Whether this computer reads the review pages: the first running computer
 * signed in as an owner. Only one does, so a review is not read twice.
 */
export function readsReviews(running: FinderComputer[], me: string, ownerProfiles: ReadonlySet<string>): boolean {
  const first = running.find((c) => c.profileId && ownerProfiles.has(c.profileId));
  return first ? first.id === me : true;
}
