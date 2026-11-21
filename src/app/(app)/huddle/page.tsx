import Link from "next/link";
import { redirect } from "next/navigation";

import { HuddleView } from "@/components/huddle/huddle-view";
import { Screen } from "@/components/phone/parts";
import { isAccountManager } from "@/lib/affiliate-roles";
import { loadHuddle } from "@/lib/data/huddle";
import { getCurrentProfile } from "@/lib/data/team";
import { HUDDLE_MINUTES } from "@/lib/huddle";
import { isOwnerLevel } from "@/lib/roles";
import { dateKeyIn } from "@/lib/time-zone";

export const dynamic = "force-dynamic";

const shift = (day: string, by: number) => {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + by);
  return d.toISOString().slice(0, 10);
};
const label = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });

/**
 * The morning team huddle: ten minutes, the same five steps every morning,
 * filled in from the day's crews. ?day=YYYY-MM-DD opens another day.
 */
export default async function HuddlePage({ searchParams }: { searchParams: Promise<{ day?: string }> }) {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login?next=/huddle");
  const { day: asked } = await searchParams;
  const today = dateKeyIn(new Date());
  const day = asked && /^\d{4}-\d{2}-\d{2}$/.test(asked) ? asked : today;

  const huddle = await loadHuddle(profile.organization_id, day);
  const canEdit = isOwnerLevel(profile.roles) || profile.roles.includes("admin") || isAccountManager(profile.roles);

  return (
    <Screen hello="Team huddle" role={`${day === today ? "Today" : label(day)} · ${HUDDLE_MINUTES} minutes`}>
      <div className="vx-one-h" style={{ padding: "0 4px" }}>
        <Link href={`/huddle?day=${shift(day, -1)}`} className="vx-sm">
          ← {label(shift(day, -1))}
        </Link>
        {day !== today && (
          <Link href="/huddle" className="vx-sm">
            Today
          </Link>
        )}
        <Link href={`/huddle?day=${shift(day, 1)}`} className="vx-sm">
          {label(shift(day, 1))} →
        </Link>
      </div>
      <HuddleView key={day} huddle={huddle} canEdit={canEdit} />
    </Screen>
  );
}
