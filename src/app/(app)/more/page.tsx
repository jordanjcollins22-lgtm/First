import Link from "next/link";

import { getCurrentProfile } from "@/lib/data/team";
import { getAllowedTabs } from "@/lib/data/access";
import { moreTabs } from "@/lib/nav-groups";

/**
 * Everything that is not one of the eight.
 *
 * The nav had seventeen entries, which is a list people scan rather than
 * read. The work of the business is named directly now and the rest lives
 * here — the same pages at the same addresses with the same permissions, one
 * tap further away instead of competing for attention with the things
 * somebody opens every day.
 *
 * Nothing was removed. If one of these turns out to be daily work it gets
 * promoted by moving a line in `nav-groups.ts`; if it is never opened again it
 * costs nobody anything sitting here.
 *
 * It shows only what the viewer already has permission for, which is why it
 * needs no permission of its own: it can never be a way into something they
 * were not granted.
 */
export default async function MorePage() {
  const profile = await getCurrentProfile();
  const allowed = await getAllowedTabs();
  const tools = moreTabs([...allowed]);

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:py-8">
      <h1 className="mb-1 text-2xl font-bold">More</h1>
      <p className="mb-4 text-sm text-muted-foreground sm:mb-6 sm:text-base">
        Everything else the app can do. The eight in the menu are the day-to-day; these are here
        when you need them.
      </p>

      {tools.length === 0 ? (
        <p className="rounded-lg border border-border bg-card/60 px-3 py-6 text-center text-sm text-muted-foreground">
          Nothing else is open to you yet. An admin can grant more on Settings.
        </p>
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2">
          {tools.map((tool) => (
            <li key={tool.key}>
              <Link
                href={tool.href}
                className="flex min-h-14 items-center rounded-lg border border-border bg-card/60 px-3 py-2.5 text-sm font-semibold hover:border-primary hover:text-primary"
              >
                {tool.label}
              </Link>
            </li>
          ))}
        </ul>
      )}

      {profile?.roles.includes("admin") && (
        <p className="mt-4 text-xs text-muted-foreground">
          Anything here can be promoted into the main menu. Say which and it moves.
        </p>
      )}
    </div>
  );
}
