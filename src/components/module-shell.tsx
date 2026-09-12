import { redirect } from "next/navigation";

import { checkTabAccess } from "@/lib/data/access";
import { listRolePermissions } from "@/lib/data/permissions";
import { getCurrentProfile } from "@/lib/data/team";
import { tabsAllowedForRoles } from "@/lib/permissions";
import { moduleFor, openingSubtab, subtabsFor, type ModuleKey } from "@/lib/modules";
import { PageTabs, type PageTab } from "@/components/ui/page-tabs";

/**
 * One module: its name, the question it answers, and its subtabs.
 *
 * The subtabs a person cannot open are not rendered at all -- not disabled,
 * not shown greyed. A module holding six tools where somebody is allowed one
 * should look like a page with one thing on it, because that is what it is
 * for them.
 *
 * The content of each subtab is passed in by the page, which is what keeps
 * this a reorganisation: every subtab renders the screen that already
 * existed, at the permission it already had.
 */
export async function ModuleShell({
  module: key,
  asked,
  content,
}: {
  module: ModuleKey;
  /** The `?tab=` a link asked for. */
  asked?: string | null;
  /** What to render for each subtab key. A missing one is simply not shown. */
  content: Record<string, React.ReactNode>;
}) {
  const mod = moduleFor(key);
  if (!mod) redirect("/my-day");

  const profile = await getCurrentProfile();
  const permissions = await listRolePermissions().catch(() => []);
  const allowed = Array.from(tabsAllowedForRoles(profile?.roles ?? [], permissions));

  const open = subtabsFor(key, allowed).filter((subtab) => content[subtab.key] != null);
  // Nothing in here is theirs. Send them to their own screen rather than
  // showing an empty page with a heading on it.
  if (open.length === 0) redirect("/my-day");

  const tabs: PageTab[] = open.map((subtab) => ({
    key: subtab.key,
    label: subtab.label,
    blurb: subtab.blurb,
    content: content[subtab.key],
  }));

  return (
    <div className="px-4 py-4 sm:py-6">
      <header className="mb-3">
        <h1 className="text-xl font-semibold">{mod.label}</h1>
        <p className="text-sm text-muted-foreground">{mod.question}</p>
      </header>
      <PageTabs tabs={tabs} initialKey={openingSubtab(key, allowed, asked) ?? undefined} />
    </div>
  );
}

/**
 * Whether the signed-in person holds any of these permissions.
 *
 * Used by a module page to decide whether to do a subtab's data loading at
 * all -- a page that fetched the county map for somebody not allowed to see
 * it would be slow for them and would then throw it away.
 */
export async function holdsAny(keys: string[]): Promise<boolean> {
  for (const key of keys) {
    const { allowed } = await checkTabAccess(key);
    if (allowed) return true;
  }
  return false;
}
