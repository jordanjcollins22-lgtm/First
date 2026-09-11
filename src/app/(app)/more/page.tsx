import Link from "next/link";

import { getCurrentProfile } from "@/lib/data/team";
import { getAllowedTabs } from "@/lib/data/access";
import { moduleFor, subtabsFor } from "@/lib/modules";
import { TABS, type TabDefinition } from "@/lib/permissions";

/**
 * The company and admin tools, grouped by what they are for.
 *
 * The nav names the work of the business; this is everything the work runs on
 * — stock, people, prices, money, references, the county data, the settings.
 * Same pages, same addresses, same permissions, one tap further away instead
 * of competing for attention with the screens somebody opens every day.
 *
 * It shows only what the viewer already has permission for, which is why it
 * needs no permission of its own: it can never be a way into something they
 * were not granted.
 */

const BY_KEY = new Map(TABS.map((tab) => [tab.key, tab]));

/**
 * What a group opens is the permission keys it is already made of.
 *
 * This used to be a second, hand-written list beside the modules, and it went
 * stale exactly the way a second list of anything does: three pages were added
 * to the app and never added here, so Fleet, Subscriptions, Transactions and
 * Client messaging had no link anywhere and a group whose pages all resolved
 * to nothing disappeared from the screen entirely. Somebody with every
 * permission granted still could not reach them.
 *
 * Derived now, so it cannot drift. A subtab names the tabs that open it; those
 * are the pages.
 */
function pagesFor(subtab: { tabs: string[] }, allowed: string[]): TabDefinition[] {
  return subtab.tabs
    .map((key) => BY_KEY.get(key))
    .filter((tab): tab is TabDefinition => tab != null && allowed.includes(tab.key));
}

export default async function MorePage() {
  const profile = await getCurrentProfile();
  const allowed = [...(await getAllowedTabs())];
  const groups = subtabsFor("more", allowed);
  const question = moduleFor("more")?.question ?? "";
  const isAdmin = profile?.roles.includes("admin") ?? false;
  const listed = new Set<string>();

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:py-8">
      <h1 className="text-xl font-semibold">More</h1>
      <p className="mb-5 text-sm text-muted-foreground">{question}</p>

      {groups.length === 0 && !isAdmin ? (
        <p className="rounded-lg border border-border bg-card/60 px-3 py-6 text-center text-sm text-muted-foreground">
          Nothing else is open to you yet. An admin can grant more on Settings.
        </p>
      ) : (
        <div className="space-y-5">
          {groups.map((group) => {
            // A page belongs to the first group that opens it. Services lists
            // Team as well, so that somebody granted only Team can still reach
            // it, and without this it would appear twice.
            const pages = pagesFor(group, allowed).filter((page) => {
              if (listed.has(page.key)) return false;
              listed.add(page.key);
              return true;
            });
            if (pages.length === 0) return null;
            return (
              <section key={group.key}>
                <h2 className="mb-1.5 text-sm font-semibold">{group.label}</h2>
                <ul className="grid gap-2 sm:grid-cols-2">
                  {pages.map((page) => (
                    <li key={page.key}>
                      <Link
                        href={page.href}
                        className="flex min-h-12 items-center rounded-lg border border-border bg-card/60 px-3 py-2.5 text-sm font-medium hover:border-primary hover:text-primary"
                      >
                        {page.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}

          {/* Gated on the admin role itself, never on the table it edits —
              otherwise one stray uncheck takes away the way back in. */}
          {isAdmin && (
            <section>
              <h2 className="mb-1.5 text-sm font-semibold">Settings</h2>
              <ul className="grid gap-2 sm:grid-cols-2">
                <li>
                  <Link
                    href="/admin/settings"
                    className="flex min-h-12 items-center rounded-lg border border-border bg-card/60 px-3 py-2.5 text-sm font-medium hover:border-primary hover:text-primary"
                  >
                    Permissions, email, database &amp; organizations
                  </Link>
                </li>
              </ul>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
